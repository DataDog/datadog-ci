import type {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'

import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {XMLParser} from 'fast-xml-parser'
import upath from 'upath'

/**
 * Flaky Test Management verdict for JUnit XML uploads.
 *
 * Decides, after the tests ran, whether a failed run should still pass CI because every failing testcase is
 * quarantined or disabled in Datadog. Go reports get Go rules: failures are judged at the leaves, a quarantined ancestor
 * covers its subtests, and the last rerun wins.
 */

export interface TestRun {
  suite: string
  name: string
  /** The backend's test.module for this report: its file name. */
  module: string
  failed: boolean
  /** Report written by Go tooling (go.version property): subtests are "Parent/Child" and a parent fails with them. */
  go: boolean
  /** A Go failure whose output shows the test binary died (panic or timeout), so later tests may not have run. */
  aborted: boolean
}

/** module -> suite -> names of quarantined or disabled tests. JUnit tests normally sit under the empty module. */
export type ExcusedTests = Map<string, Map<string, Set<string>>>

export interface Verdict {
  excused: TestRun[]
  real: TestRun[]
}

/** A report Datadog would not ingest, so its failures can never be matched. */
export class UnreadableReportError extends Error {}

/** The exit code most test runners use for "tests failed". Bazel uses 3, cargo-nextest 100, ctest 8. */
export const DEFAULT_TEST_FAILURE_EXIT_CODE = 1

const SUITE_TAG = 'test.suite'
const NAME_TAG = 'test.name'
const PROPERTY_TAG = /^dd_tags\[(.+)\]$/
// The four --xpath-tag forms the backend supports (single quotes only).
const XPATH = /^\/testcase(\/\.\.)?(?:\/@([^/]+)|\/(?:properties)?\/property\[@name='(.+)'\])$/
const GO_ABORT = /^panic: |\btest timed out after\b/m

// processEntities stays off (no DOCTYPE expansion); the five predefined entities and character references are
// decoded by hand, like the backend's encoding/xml does. trimValues is off because the backend doesn't trim.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: false,
  isArray: (name) => name === 'testsuite' || name === 'testcase' || name === 'property',
})

const ENTITIES: Record<string, string> = {lt: '<', gt: '>', amp: '&', apos: "'", quot: '"'}
const decode = (value: unknown): string =>
  String(value ?? '').replace(/&(?:(lt|gt|amp|apos|quot)|#(\d+)|#x([0-9a-fA-F]+));/g, (_, named, dec, hex) =>
    named ? ENTITIES[named] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16))
  )

type XmlNode = Record<string, any>

// An element with no attributes and no children parses to a string.
const asNode = (value: unknown): XmlNode => (typeof value === 'object' && !!value ? (value as XmlNode) : {})

const attribute = (node: XmlNode, name: string): string | undefined => {
  // The backend lowercases attribute names.
  const key = Object.keys(node).find((k) => k.startsWith('@_') && k.slice(2).toLowerCase() === name.toLowerCase())

  return key === undefined ? undefined : decode(node[key])
}

const properties = (node: XmlNode): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const property of asNode(node.properties).property ?? []) {
    const name = attribute(asNode(property), 'name')
    if (name !== undefined) {
      result[name] = attribute(asNode(property), 'value') ?? ''
    }
  }

  return result
}

const ddTag = (props: Record<string, string>, tag: string): string | undefined => {
  for (const [key, value] of Object.entries(props)) {
    if (PROPERTY_TAG.exec(key)?.[1] === tag) {
      return value
    }
  }
}

const xpathValue = (expression: string, testcase: XmlNode, suite: XmlNode): string | undefined => {
  const match = XPATH.exec(expression)
  if (!match) {
    return undefined
  }
  const [, parent, attr, property] = match
  const node = parent ? suite : testcase

  return attr ? attribute(node, attr) : properties(node)[property]
}

/**
 * Resolves test.suite / test.name with the backend's precedence:
 * XML default < suite dd_tags[...] property < testcase dd_tags[...] property < --xpath-tag < --tags / DD_TAGS.
 */
const resolveTag = (
  tag: string,
  fallback: string,
  testcase: XmlNode,
  suite: XmlNode,
  xpathTags: Record<string, string>,
  customTags: Record<string, string>
): string => {
  let value = ddTag(properties(suite), tag) ?? fallback
  value = ddTag(properties(testcase), tag) ?? value
  if (xpathTags[tag]) {
    value = xpathValue(xpathTags[tag], testcase, suite) ?? value
  }

  return customTags[tag] ?? value
}

const failureBody = (testcase: XmlNode): string | undefined => {
  for (const key of ['failure', 'error']) {
    if (key in testcase) {
      const node = testcase[key]

      return typeof node === 'object'
        ? `${attribute(asNode(node), 'message') ?? ''}\n${decode(node['#text'])}`
        : decode(node)
    }
  }
}

/** Every testcase of a JUnit XML report, keyed the way the backend keys it. */
export const parseReport = (
  xml: string,
  reportPath: string,
  xpathTags: Record<string, string> = {},
  customTags: Record<string, string> = {}
): TestRun[] => {
  const module = `${upath.parse(reportPath).name}.xml`
  const runs: TestRun[] = []

  interface Suite {
    node: XmlNode
    fullName: string
    go: boolean
  }

  const visitTestcase = (testcase: XmlNode, suite: Suite | undefined) => {
    const body = failureBody(testcase)
    const go = suite?.go ?? false
    runs.push({
      // A testcase outside any <testsuite> can't be matched: an empty suite keeps it unexcused.
      suite: suite ? resolveTag(SUITE_TAG, suite.fullName, testcase, suite.node, xpathTags, customTags) : '',
      name: resolveTag(NAME_TAG, attribute(testcase, 'name') ?? '', testcase, suite?.node ?? {}, xpathTags, customTags),
      module,
      failed: body !== undefined,
      go,
      aborted: go && body !== undefined && GO_ABORT.test(body),
    })
  }

  const visit = (node: XmlNode, suite: Suite | undefined) => {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'testsuite') {
        for (const child of value as unknown[]) {
          const suiteNode = asNode(child)
          const ownName = attribute(suiteNode, 'name') ?? ''
          if (!ownName && !xpathTags[SUITE_TAG]) {
            // The backend drops the whole file when a suite has no name.
            throw new UnreadableReportError('a <testsuite> has no name, so Datadog drops this report')
          }
          const parentName = suite?.fullName ?? ''
          // Nested suite names are joined with ".", as the backend does.
          const fullName = parentName && ownName ? `${parentName}.${ownName}` : parentName || ownName
          const go = (suite?.go ?? false) || 'go.version' in properties(suiteNode)
          visit(suiteNode, {node: suiteNode, fullName, go})
        }
      } else if (key === 'testcase') {
        for (const child of value as unknown[]) {
          visitTestcase(asNode(child), suite)
        }
      } else if (key !== 'properties' && !key.startsWith('@_') && key !== '#text' && typeof value === 'object') {
        // Wrapper elements (and the <testsuites> root): the backend's streaming parser finds suites at any depth.
        for (const child of Array.isArray(value) ? value : [value]) {
          visit(asNode(child), suite)
        }
      }
    }
  }
  visit(parser.parse(xml), undefined)

  return runs
}

const keyOf = (run: TestRun) => `${run.suite}\u0000${run.name}`

/** The runs that count as failing: for Go the last attempt of a test wins (gotestsum --rerun-fails), else any failure. */
export const failingRuns = (runs: TestRun[]): TestRun[] => {
  const lastGoAttempt = new Map<string, TestRun>()
  const failing: TestRun[] = []
  for (const run of runs) {
    if (run.go) {
      lastGoAttempt.set(keyOf(run), run)
    } else if (run.failed) {
      failing.push(run)
    }
  }

  return [...failing, ...[...lastGoAttempt.values()].filter((run) => run.failed)]
}

/**
 * Asks Datadog which tests are quarantined or disabled, with the API-key endpoint the test libraries use.
 * No module is sent: JUnit tests have no module and come back under `modules[""]`.
 */
export const fetchExcusedTests = async (
  request: RequestBuilder,
  attributes: {repositoryUrl: string; sha: string; branch?: string; commitMessage?: string}
): Promise<ExcusedTests> => {
  const response = await retryRequest(
    () =>
      request({
        method: 'POST',
        url: datadogRoute('/api/v2/test/libraries/test-management/tests'),
        timeout: 20_000,
        data: {
          data: {
            type: 'ci_app_libraries_tests_request',
            attributes: {
              repository_url: attributes.repositoryUrl,
              sha: attributes.sha,
              branch: attributes.branch,
              commit_message: attributes.commitMessage,
            },
          },
        },
      }),
    {retries: 2}
  )

  const excused: ExcusedTests = new Map()
  for (const [module, {suites}] of Object.entries<XmlNode>(response.data?.data?.attributes?.modules ?? {})) {
    for (const [suite, {tests}] of Object.entries<XmlNode>(suites ?? {})) {
      for (const [name, {properties: props}] of Object.entries<XmlNode>(tests ?? {})) {
        if (props?.quarantined === true || props?.disabled === true) {
          const bySuite = excused.get(module) ?? new Map<string, Set<string>>()
          bySuite.set(suite, (bySuite.get(suite) ?? new Set()).add(name))
          excused.set(module, bySuite)
        }
      }
    }
  }

  return excused
}

/** "A/b/c" -> "A/b/c", "A/b", "A": in Go, quarantining a parent covers its subtests. */
const testAndAncestors = (name: string): string[] =>
  name.split('/').map((_, i, parts) => parts.slice(0, parts.length - i).join('/'))

const isExcused = (run: TestRun, excused: ExcusedTests): boolean => {
  const names = run.go ? testAndAncestors(run.name) : [run.name]
  const has = (module: string, suite: string) => names.some((n) => excused.get(module)?.get(suite)?.has(n))
  // JUnit entries: the empty module, or a report file name. Entries added through the public API from a JUnit event
  // keep that event's file name as module, so they must match from any report.
  // ponytail: the *.xml modules are only needed until the API stops storing a file name as module for JUnit tests.
  if ([...excused.keys()].some((module) => (module === '' || module.endsWith('.xml')) && has(module, run.suite))) {
    return true
  }
  // dd-trace-go keys the same test by module = import path (the JUnit suite) and suite = source file.
  // ponytail: Go only; other native identities aren't mapped to JUnit ones.

  return run.go && [...(excused.get(run.suite)?.keys() ?? [])].some((suite) => has(run.suite, suite))
}

/**
 * Judges Go failures at the leaves: a parent fails whenever a subtest fails, so a failing test with a failing
 * "<name>/" subtest in the same suite is not judged. Known limitation, the same as dd-trace-go:
 * a parent that also fails on its own assertion is missed.
 */
export const decide = (failing: TestRun[], excused: ExcusedTests): Verdict => {
  const unique = [...new Map(failing.map((run) => [`${run.module}\u0000${keyOf(run)}`, run])).values()]
  const isParent = (run: TestRun) =>
    run.go && unique.some((other) => other.go && other.suite === run.suite && other.name.startsWith(`${run.name}/`))
  const verdict: Verdict = {excused: [], real: []}
  for (const run of unique.filter((r) => !isParent(r))) {
    ;(!run.aborted && isExcused(run, excused) ? verdict.excused : verdict.real).push(run)
  }

  return verdict
}

export interface JudgeInput {
  exitCode: number
  /**
   * The exit code the test runner uses when tests failed. Only this code can be excused: any other code means the
   * runner itself broke, or the job was killed.
   */
  testFailureExitCode?: number
  reports: {path: string; xml: string}[]
  /** Candidate report files that failed validation and were not uploaded. */
  invalidReports: string[]
  git: {repositoryUrl?: string; sha?: string; branch?: string; commitMessage?: string}
  xpathTags?: Record<string, string>
  customTags?: Record<string, string>
  fetch: (git: {repositoryUrl: string; sha: string; branch?: string; commitMessage?: string}) => Promise<ExcusedTests>
}

/** The exit code to use, and what to print. Anything the reports cannot explain keeps the test command's code. */
export const judge = async (input: JudgeInput): Promise<{exitCode: number; lines: string[]}> => {
  const {exitCode} = input
  if (exitCode === 0) {
    return {exitCode, lines: []}
  }
  const keep = (reason: string, details: string[] = []) => ({
    exitCode,
    lines: [...details, `Test exit code ${exitCode} kept: ${reason}`],
  })

  const testFailureExitCode = input.testFailureExitCode ?? DEFAULT_TEST_FAILURE_EXIT_CODE
  if (exitCode !== testFailureExitCode) {
    return keep(`only the test runner's "tests failed" exit code (${testFailureExitCode}) can be excused`)
  }
  if (input.invalidReports.length) {
    return keep(`${input.invalidReports.length} report(s) could not be read: ${input.invalidReports.join(', ')}`)
  }

  let runs: TestRun[]
  try {
    runs = input.reports.flatMap((r) => parseReport(r.xml, r.path, input.xpathTags, input.customTags))
  } catch (error) {
    return keep(`a report could not be read (${(error as Error).message})`)
  }
  const failing = failingRuns(runs)
  if (!failing.length) {
    return keep('no failing testcase in the reports, so the failure cannot be a quarantined test')
  }

  const {repositoryUrl, sha, branch, commitMessage} = input.git
  if (!repositoryUrl || !sha) {
    return keep('the git repository URL or commit SHA is unknown')
  }

  let excusedTests: ExcusedTests
  try {
    excusedTests = await input.fetch({repositoryUrl, sha, branch, commitMessage})
  } catch (error) {
    return keep(`could not fetch Flaky Test Management states (${(error as Error).message})`)
  }

  const {excused, real} = decide(failing, excusedTests)
  const lines = excused.map((t) => `Quarantined or disabled, ignored: ${t.suite} ${t.name}`)
  if (real.length) {
    for (const t of real) {
      lines.push(
        `${t.aborted ? 'Failing, and the test binary died (panic or timeout)' : 'Failing'}: ${t.suite} ${t.name}`
      )
    }

    return keep(`${real.length} failing test(s) are not quarantined or disabled, or aborted the run`, lines)
  }
  lines.push(`All ${excused.length} failing test(s) are quarantined or disabled: exiting 0 instead of ${exitCode}`)

  return {exitCode: 0, lines}
}
