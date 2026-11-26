import type {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'

import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {XMLParser} from 'fast-xml-parser'
import upath from 'upath'

/**
 * Flaky Test Management verdict for JUnit XML uploads.
 *
 * Decides, after the tests ran, whether a failed run should still pass CI because every failing testcase is
 * quarantined or disabled in Datadog. Go reports get Go rules: failures are judged at the leaves, and the last rerun
 * wins.
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
  /** The report file, and the testcase's position in it in document order: where to tag it before the upload. */
  report?: string
  index?: number
  /** The testcase's own name attribute, to check that the position still points at it when tagging. */
  rawName?: string
  classname?: string
  /** Another testcase has the same suite and name but another classname: Datadog merges them, so neither is excused. */
  ambiguous?: boolean
}

/** The Flaky Test Management state that excuses a failure. */
export type ExcusedState = 'quarantined' | 'disabled'

/** module -> suite -> test name -> state of quarantined or disabled tests. JUnit tests normally sit under the empty module. */
export type ExcusedTests = Map<string, Map<string, Map<string, ExcusedState>>>

export interface ExcusedRun extends TestRun {
  state: ExcusedState
}

export interface Verdict {
  excused: ExcusedRun[]
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

// Set on each parsed <testcase>: its position among the report's <testcase> start tags, in document order.
const POSITION = '@_\u0000position'

// processEntities stays off (no DOCTYPE expansion); the five predefined entities and character references are
// decoded by hand, like the backend's encoding/xml does. trimValues is off because the backend doesn't trim.
const newParser = () => {
  let testcases = 0

  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    trimValues: false,
    isArray: (name) => name === 'testsuite' || name === 'testcase' || name === 'property',
    // Called for each element in document order, which the parsed object doesn't keep across element names.
    updateTag: (tagName, _jPath, attributes) => {
      if (tagName === 'testcase') {
        const position = testcases++
        if (attributes) {
          attributes[POSITION] = String(position)
        }
      }

      return tagName
    },
  })
}

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
    const position = testcase[POSITION] as string | undefined
    runs.push({
      // A testcase outside any <testsuite> can't be matched: an empty suite keeps it unexcused.
      suite: suite ? resolveTag(SUITE_TAG, suite.fullName, testcase, suite.node, xpathTags, customTags) : '',
      name: resolveTag(NAME_TAG, attribute(testcase, 'name') ?? '', testcase, suite?.node ?? {}, xpathTags, customTags),
      module,
      failed: body !== undefined,
      go,
      aborted: go && body !== undefined && GO_ABORT.test(body),
      report: reportPath,
      index: position === undefined ? undefined : Number(position),
      rawName: attribute(testcase, 'name'),
      classname: attribute(testcase, 'classname'),
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
  visit(newParser().parse(xml), undefined)

  return runs
}

const keyOf = (run: TestRun) => `${run.suite}\u0000${run.name}`
// Reruns, duplicates and Go parents only make sense within one report: another report is another execution.
const reportKeyOf = (run: TestRun) => `${run.report ?? run.module}\u0000${keyOf(run)}`

/** The runs that count as failing: for Go the last attempt of a test wins (gotestsum --rerun-fails), else any failure. */
export const failingRuns = (runs: TestRun[]): TestRun[] => {
  const lastGoAttempt = new Map<string, TestRun>()
  const failing: TestRun[] = []
  for (const run of runs) {
    if (run.go) {
      lastGoAttempt.set(reportKeyOf(run), run)
    } else if (run.failed) {
      failing.push(run)
    }
  }

  return [...failing, ...[...lastGoAttempt.values()].filter((run) => run.failed)]
}

/** The git values the uploaded tests get: --tags and DD_TAGS win over the CI and git metadata, as in the backend. */
export const effectiveGit = (
  spanTags: Record<string, string | undefined>,
  customTags: Record<string, string>
): {repositoryUrl?: string; sha?: string; branch?: string; commitMessage?: string} => {
  const value = (tag: string) => customTags[tag] ?? spanTags[tag]

  return {
    repositoryUrl: value('git.repository_url'),
    sha: value('git.commit.sha'),
    branch: value('git.branch'),
    commitMessage: value('git.commit.message'),
  }
}

type Git = {repositoryUrl: string; sha: string; branch?: string; commitMessage?: string}

/**
 * Whether Flaky Test Management is on for this repository, as the test libraries see it: the `test_management.enabled`
 * setting they read before a run. The CLI then applies quarantine exactly when they do.
 */
export const fetchQuarantineEnabled = async (
  request: RequestBuilder,
  attributes: Git & {service: string; env?: string}
): Promise<boolean> => {
  const response = await retryRequest(
    () =>
      request({
        method: 'POST',
        url: datadogRoute('/api/v2/libraries/tests/services/setting'),
        timeout: 10_000,
        data: {
          data: {
            id: '1',
            type: 'ci_app_test_service_libraries_settings',
            attributes: {
              service: attributes.service,
              env: attributes.env ?? 'none',
              repository_url: attributes.repositoryUrl,
              sha: attributes.sha,
              // Required by the endpoint. dd-trace-go sends the same value when it has no branch.
              branch: attributes.branch ?? 'auto:git-detached-head',
              configurations: {},
              test_level: 'test',
            },
          },
        },
      }),
    {retries: 2}
  )

  return response.data?.data?.attributes?.test_management?.enabled === true
}

/**
 * Asks Datadog which tests are quarantined or disabled, with the API-key endpoint the test libraries use.
 * No module is sent: JUnit tests have no module and come back under `modules[""]`. Nor are the branch and commit
 * message: they only drive attempt-to-fix, which JUnit reports can't run, and with a branch the endpoint fails with a
 * 500 for repositories without Flaky Test Management settings.
 */
export const fetchExcusedTests = async (request: RequestBuilder, attributes: Git): Promise<ExcusedTests> => {
  const response = await retryRequest(
    () =>
      request({
        method: 'POST',
        url: datadogRoute('/api/v2/test/libraries/test-management/tests'),
        timeout: 10_000,
        data: {
          data: {
            type: 'ci_app_libraries_tests_request',
            attributes: {
              repository_url: attributes.repositoryUrl,
              sha: attributes.sha,
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
        // A disabled test is skipped by the test libraries, so its state wins.
        const state: ExcusedState | undefined =
          props?.disabled === true ? 'disabled' : props?.quarantined === true ? 'quarantined' : undefined
        if (state) {
          const bySuite = excused.get(module) ?? new Map<string, Map<string, ExcusedState>>()
          bySuite.set(suite, (bySuite.get(suite) ?? new Map()).set(name, state))
          excused.set(module, bySuite)
        }
      }
    }
  }

  return excused
}

/**
 * The state that excuses this run, if any: its own. A quarantined Go parent doesn't cover its subtests, unlike in
 * dd-trace-go: in JUnit reports a parent fails whenever a subtest does, so Flaky Test Management sees a parent as flaky
 * as soon as one subtest is, and its policies can quarantine it. Covering the subtests would then hide their real
 * failures.
 */
export const excusedState = (run: TestRun, excused: ExcusedTests): ExcusedState | undefined => {
  const stateIn = (module: string, suite: string) => excused.get(module)?.get(suite)?.get(run.name)
  // JUnit entries: the empty module, or a report file name. Entries added through the public API from a JUnit event
  // keep that event's file name as module, so they must match from any report.
  // The *.xml modules can go once the API stops storing a file name as module for JUnit tests.
  for (const module of excused.keys()) {
    const state = module === '' || module.endsWith('.xml') ? stateIn(module, run.suite) : undefined
    if (state) {
      return state
    }
  }
  // dd-trace-go keys the same test by module = import path (the JUnit suite) and suite = source file.
  // Go only: other native identities aren't mapped to JUnit ones.
  if (run.go) {
    for (const suite of excused.get(run.suite)?.keys() ?? []) {
      const state = stateIn(run.suite, suite)
      if (state) {
        return state
      }
    }
  }
}

/**
 * Judges Go failures at the leaves: a parent fails whenever a subtest fails, so a failing test with a failing
 * "<name>/" subtest in the same suite is not judged. Known limitation, the same as dd-trace-go:
 * a parent that also fails on its own assertion is missed.
 */
export const decide = (failing: TestRun[], excused: ExcusedTests): Verdict => {
  const unique = [...new Map(failing.map((run) => [reportKeyOf(run), run])).values()]
  const isParent = (run: TestRun) =>
    run.go &&
    unique.some(
      (other) =>
        other.go &&
        (other.report ?? other.module) === (run.report ?? run.module) &&
        other.suite === run.suite &&
        other.name.startsWith(`${run.name}/`)
    )
  const verdict: Verdict = {excused: [], real: []}
  // A parent that panicked or timed out is judged anyway: its failure isn't only its subtests'.
  for (const run of unique.filter((r) => r.aborted || !isParent(r))) {
    const state = run.aborted || run.ambiguous ? undefined : excusedState(run, excused)
    if (state) {
      verdict.excused.push({...run, state})
    } else {
      verdict.real.push(run)
    }
  }

  return verdict
}

const TAG_OF_STATE: Record<ExcusedState, string> = {
  quarantined: 'test.test_management.is_quarantined',
  disabled: 'test.test_management.is_test_disabled',
}

// A <testcase> start tag, with its attributes and whether it closes itself. Comments, CDATA sections, processing
// instructions and the DOCTYPE (with its internal subset) are matched only to be skipped, so a "<testcase" inside them
// isn't counted. The name must end there: <testcase.step> or <testcase-info> are other elements.
const TESTCASE_START =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?]]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?])*>|<testcase(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const NAME_ATTRIBUTE = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * Adds the Flaky Test Management tags to the given testcases, found by position, as `dd_tags[...]` properties: the
 * backend then shows those runs as quarantined or disabled, as the test libraries do. Nothing else in the report
 * changes. Returns undefined, so the report is uploaded as it is, when a position doesn't point at the expected
 * testcase.
 */
export const tagReport = (
  xml: string,
  runs: {index: number; rawName?: string; state: ExcusedState}[]
): string | undefined => {
  const wanted = new Map(runs.map((run) => [run.index, run]))
  let position = -1
  let tagged = 0
  let mismatch = false
  const result = xml.replace(TESTCASE_START, (match: string, attributes?: string, selfClosing?: string) => {
    if (attributes === undefined) {
      return match
    }
    position++
    const run = wanted.get(position)
    if (!run) {
      return match
    }
    const name = NAME_ATTRIBUTE.exec(attributes)
    if ((name ? decode(name[1] ?? name[2]) : undefined) !== run.rawName) {
      mismatch = true

      return match
    }
    tagged++
    const tag = `<properties><property name="dd_tags[${TAG_OF_STATE[run.state]}]" value="true"></property></properties>`

    return selfClosing ? `<testcase${attributes}>${tag}</testcase>` : `${match}${tag}`
  })

  return mismatch || tagged !== wanted.size ? undefined : result
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
  /** Whether quarantine is on for the repository, as the test libraries see it. */
  isEnabled: (git: Git) => Promise<boolean>
  fetch: (git: Git) => Promise<ExcusedTests>
}

export interface JudgeResult {
  exitCode: number
  lines: string[]
  /** Runs of quarantined or disabled tests, failing or not, to tag in the uploaded reports. */
  toTag: ExcusedRun[]
}

/** The exit code to use, and what to print. Anything the reports cannot explain keeps the test command's code. */
export const judge = async (input: JudgeInput): Promise<JudgeResult> => {
  const {exitCode} = input
  if (exitCode === 0) {
    return {exitCode, lines: [], toTag: []}
  }
  // Exit codes wrap modulo 256 on POSIX: keep anything outside 1..255 as 1, so it can't become 0.
  const kept = exitCode >= 1 && exitCode <= 255 ? exitCode : 1
  const keep = (reason: string, details: string[] = [], tagged: ExcusedRun[] = []) => ({
    exitCode: kept,
    lines: [...details, `Test exit code ${exitCode} kept${kept === exitCode ? '' : ` (as ${kept})`}: ${reason}`],
    toTag: tagged,
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
  // Datadog identifies a JUnit test by suite + name. The same pair with different classnames is two tests merged into
  // one (pytest's default <testsuite name="pytest">, for example), so a quarantined one must not excuse the other.
  const classnames = new Map<string, Set<string>>()
  for (const run of runs) {
    classnames.set(keyOf(run), (classnames.get(keyOf(run)) ?? new Set()).add(run.classname ?? ''))
  }
  for (const run of runs) {
    run.ambiguous = (classnames.get(keyOf(run))?.size ?? 0) > 1
  }
  const failing = failingRuns(runs)
  if (!failing.length) {
    return keep('no failing testcase in the reports, so the failure cannot be a quarantined test')
  }

  const {repositoryUrl, sha, branch, commitMessage} = input.git
  if (!repositoryUrl || !sha) {
    return keep('the git repository URL or commit SHA is unknown')
  }
  const git = {repositoryUrl, sha, branch, commitMessage}

  try {
    if (!(await input.isEnabled(git))) {
      return keep('quarantine is turned off for this repository in Flaky Test Management')
    }
  } catch (error) {
    return keep(`could not read the Flaky Test Management settings (${(error as Error).message})`)
  }

  let excusedTests: ExcusedTests
  try {
    excusedTests = await input.fetch(git)
  } catch (error) {
    return keep(`could not fetch Flaky Test Management states (${(error as Error).message})`)
  }

  const toTag = runs.flatMap((run) => {
    const state = run.aborted || run.ambiguous ? undefined : excusedState(run, excusedTests)

    return state ? [{...run, state}] : []
  })
  const {excused, real} = decide(failing, excusedTests)
  // The same test can fail in several reports: list and count it once.
  const once = <T extends TestRun>(list: T[], line: (run: T) => string) => [...new Set(list.map(line))]
  const count = (list: TestRun[]) => new Set(list.map(keyOf)).size
  const lines = once(
    excused,
    (t) => `${t.state === 'disabled' ? 'Disabled' : 'Quarantined'}, ignored: ${t.suite} ${t.name}`
  )
  if (real.length) {
    lines.push(
      ...once(
        real,
        (t) =>
          `${
            t.aborted
              ? 'Failing, and the test binary died (panic or timeout)'
              : t.ambiguous
                ? 'Failing, and another testcase has the same suite and name'
                : 'Failing'
          }: ${t.suite} ${t.name}`
      )
    )

    return keep(`${count(real)} failing test(s) are not quarantined or disabled, or aborted the run`, lines, toTag)
  }
  lines.push(`All ${count(excused)} failing test(s) are quarantined or disabled: exiting 0 instead of ${exitCode}`)

  return {exitCode: 0, lines, toTag}
}
