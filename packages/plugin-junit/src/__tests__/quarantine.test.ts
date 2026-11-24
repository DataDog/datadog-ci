import type {ExcusedTests, JudgeInput, TestRun} from '../quarantine'

import {decide, failingRuns, fetchExcusedTests, judge, parseReport, UnreadableReportError} from '../quarantine'

const AGENT_SUITE = 'github.com/DataDog/datadog-agent/test/new-e2e/tests/containers'
const GO_PROPS = '<properties><property name="go.version" value="go1.24.1 linux/amd64"></property></properties>'

// Shape of a real gotestsum report from datadog-agent's end-to-end tests:
// the quarantined subtest fails, and so does its parent.
const goReport = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="3" failures="2">
  <testsuite name="${AGENT_SUITE}" tests="3" failures="2">
    ${GO_PROPS}
    <testcase classname="${AGENT_SUITE}" name="TestKindSuite/Test00UpAndRunning" time="1.0"></testcase>
    <testcase classname="${AGENT_SUITE}" name="TestKindSuite/TestContainerLifecycleEvents" time="120.0">
      <failure message="Failed" type="">Error Trace: k8s_test.go:1957</failure>
    </testcase>
    <testcase classname="${AGENT_SUITE}" name="TestKindSuite" time="700.0">
      <failure message="Failed" type="">suite.go:673: ========= Some tests failed, diagnosing environment</failure>
    </testcase>
  </testsuite>
</testsuites>`

const excusedOf = (entries: [string, string, string][]): ExcusedTests => {
  const excused: ExcusedTests = new Map()
  for (const [module, suite, name] of entries) {
    const bySuite = excused.get(module) ?? new Map<string, Set<string>>()
    bySuite.set(suite, (bySuite.get(suite) ?? new Set()).add(name))
    excused.set(module, bySuite)
  }

  return excused
}

const run = (suite: string, name: string, extra: Partial<TestRun> = {}): TestRun => ({
  suite,
  name,
  module: 'report.xml',
  failed: true,
  go: false,
  aborted: false,
  ...extra,
})

const failingOf = (xml: string, path = 'junit.xml', xpathTags = {}, customTags = {}) =>
  failingRuns(parseReport(xml, path, xpathTags, customTags)).map(({suite, name}) => ({suite, name}))

describe('parseReport', () => {
  test('keys testcases by suite and name, with the file name as module, and detects Go reports', () => {
    const runs = parseReport(goReport, 'reports/junit-out-AgentFlavor.base-0.xml')
    expect(runs.map((r) => [r.name, r.failed, r.go, r.module])).toEqual([
      ['TestKindSuite/Test00UpAndRunning', false, true, 'junit-out-AgentFlavor.base-0.xml'],
      ['TestKindSuite/TestContainerLifecycleEvents', true, true, 'junit-out-AgentFlavor.base-0.xml'],
      ['TestKindSuite', true, true, 'junit-out-AgentFlavor.base-0.xml'],
    ])
    expect(runs.every((r) => r.suite === AGENT_SUITE && !r.aborted)).toBe(true)
  })

  test('counts <error> as a failure, not skipped or passing testcases, and survives attribute-less elements', () => {
    const xml = `<testsuite name="S">
      <testcase name="errored"><error message="boom"/></testcase>
      <testcase name="skipped"><skipped/></testcase>
      <testcase name="passed"/>
      <testcase/>
      <testcase name="failed"><failure/></testcase>
    </testsuite>`
    expect(failingOf(xml)).toEqual([
      {suite: 'S', name: 'errored'},
      {suite: 'S', name: 'failed'},
    ])
  })

  test('joins nested suite names with "." and finds suites under wrapper elements', () => {
    const xml = `<testsuites name="ignored root">
      <group><testsuite name="Outer"><testsuite name="Inner"><testcase name="t"><failure/></testcase></testsuite></testsuite></group>
      <testcase name="orphan"><failure/></testcase>
    </testsuites>`
    expect(failingOf(xml)).toEqual([
      {suite: 'Outer.Inner', name: 't'},
      {suite: '', name: 'orphan'},
    ])
  })

  test('a <testsuite> without a name is unreadable, as the backend drops the file, unless an xpath sets the suite', () => {
    const xml = '<testsuite name=""><testcase name="t" classname="C"><failure/></testcase></testsuite>'
    expect(() => parseReport(xml, 'r.xml')).toThrow(UnreadableReportError)
    expect(failingOf(xml, 'r.xml', {'test.suite': '/testcase/@classname'})).toEqual([{suite: 'C', name: 't'}])
  })

  test('applies dd_tags properties, then --xpath-tag, then --tags, in that order', () => {
    const xml = `<testsuite name="jest tests">
      <properties><property name="dd_tags[test.suite]" value="from-suite-property"/></properties>
      <testcase name="a" classname="com.example.A"><failure/></testcase>
      <testcase name="b"><failure/></testcase>
    </testsuite>`
    expect(failingOf(xml)).toEqual([
      {suite: 'from-suite-property', name: 'a'},
      {suite: 'from-suite-property', name: 'b'},
    ])
    expect(failingOf(xml, 'j.xml', {'test.suite': '/testcase/@classname'})).toEqual([
      {suite: 'com.example.A', name: 'a'},
      {suite: 'from-suite-property', name: 'b'},
    ])
    expect(failingOf(xml, 'j.xml', {'test.suite': '/testcase/@classname'}, {'test.suite': 'forced'})).toEqual([
      {suite: 'forced', name: 'a'},
      {suite: 'forced', name: 'b'},
    ])
  })

  test('reads the backend xpath forms: case-insensitive attributes, single-quoted properties', () => {
    const xml = `<testsuite name="S" package="pkg">
      <testcase name="t" ClassName="C"><properties><property name="nodeid" value="tests/test_x.py::t"/></properties><failure/></testcase>
    </testsuite>`
    expect(failingOf(xml, 'r.xml', {'test.suite': '/testcase/../@package'})).toEqual([{suite: 'pkg', name: 't'}])
    expect(failingOf(xml, 'r.xml', {'test.suite': '/testcase/@classname'})).toEqual([{suite: 'C', name: 't'}])
    expect(failingOf(xml, 'r.xml', {'test.name': "/testcase//property[@name='nodeid']"})).toEqual([
      {suite: 'S', name: 'tests/test_x.py::t'},
    ])
    // The backend only accepts single quotes, so a double-quoted expression is ignored there too.
    expect(failingOf(xml, 'r.xml', {'test.name': '/testcase//property[@name="nodeid"]'})).toEqual([
      {suite: 'S', name: 't'},
    ])
  })

  test('decodes entities and keeps surrounding spaces, as the backend does', () => {
    const xml = `<testsuite name="A &amp; B">
      <testcase name=" renders &lt;Button&gt; with &#34;quotes&#34; &#x27;x&#x27;"><failure/></testcase>
    </testsuite>`
    expect(failingOf(xml)).toEqual([{suite: 'A & B', name: ` renders <Button> with "quotes" 'x'`}])
  })

  test('marks a Go failure as aborted when the test binary panicked or timed out', () => {
    const xml = `<testsuite name="pkg">${GO_PROPS}
      <testcase name="TestA"><failure message="Failed">panic: runtime error: index out of range</failure></testcase>
      <testcase name="TestB"><failure message="Failed">panic: test timed out after 10m0s</failure></testcase>
      <testcase name="TestC"><failure message="Failed">x_test.go:12: want 1, got 2</failure></testcase>
    </testsuite>`
    expect(parseReport(xml, 'r.xml').map((r) => r.aborted)).toEqual([true, true, false])
  })
})

describe('failingRuns', () => {
  test('for Go the last attempt wins (gotestsum --rerun-fails), for others any failure counts', () => {
    const xml = `<testsuites>
      <testsuite name="pkg">${GO_PROPS}
        <testcase name="TestFlaky"><failure/></testcase>
        <testcase name="TestFlaky"/>
        <testcase name="TestBroken"/>
        <testcase name="TestBroken"><failure/></testcase>
      </testsuite>
      <testsuite name="jest"><testcase name="retried"><failure/></testcase><testcase name="retried"/></testsuite>
    </testsuites>`
    expect(failingOf(xml)).toEqual([
      {suite: 'jest', name: 'retried'},
      {suite: 'pkg', name: 'TestBroken'},
    ])
  })
})

describe('decide', () => {
  test('a quarantined Go subtest excuses its failing parent (the datadog-agent case)', () => {
    const verdict = decide(
      failingRuns(parseReport(goReport, 'r.xml')),
      excusedOf([['', AGENT_SUITE, 'TestKindSuite/TestContainerLifecycleEvents']])
    )
    expect(verdict.real).toEqual([])
    expect(verdict.excused.map((r) => r.name)).toEqual(['TestKindSuite/TestContainerLifecycleEvents'])
  })

  test('nothing quarantined keeps the leaf failure real', () => {
    expect(decide(failingRuns(parseReport(goReport, 'r.xml')), new Map()).real.map((r) => r.name)).toEqual([
      'TestKindSuite/TestContainerLifecycleEvents',
    ])
  })

  test('a quarantined Go parent covers all its subtests', () => {
    const failing = [
      run('S', 'TestA/one', {go: true}),
      run('S', 'TestA/two', {go: true}),
      run('S', 'TestA', {go: true}),
    ]
    expect(decide(failing, excusedOf([['', 'S', 'TestA']])).real).toEqual([])
  })

  test('outside Go, "/" in a name is not a hierarchy', () => {
    const failing = [run('routes', 'users/list'), run('routes', 'users')]
    const verdict = decide(failing, excusedOf([['', 'routes', 'users']]))
    expect(verdict.real.map((r) => r.name)).toEqual(['users/list'])
    expect(verdict.excused.map((r) => r.name)).toEqual(['users'])
  })

  test('one non-quarantined failure keeps the run red, and the same name in another suite is not excused', () => {
    const failing = [run('S', 'flaky'), run('S', 'broken'), run('S', 'flaky'), run('Other', 'flaky')]
    const verdict = decide(failing, excusedOf([['', 'S', 'flaky']]))
    expect(verdict.excused.map((r) => [r.suite, r.name])).toEqual([['S', 'flaky']])
    expect(verdict.real.map((r) => [r.suite, r.name])).toEqual([
      ['S', 'broken'],
      ['Other', 'flaky'],
    ])
  })

  test('matches the empty module and any report file name, not unrelated native modules (except Go import paths)', () => {
    const excused = excusedOf([
      ['another-report.xml', 'S', 'added-from-a-junit-event'],
      ['some-native-module', 'S', 'native-only'],
      ['github.com/o/r/pkg', 'pkg_test.go', 'TestNative'],
    ])
    const verdict = decide(
      [
        run('S', 'added-from-a-junit-event'),
        run('S', 'native-only'),
        run('github.com/o/r/pkg', 'TestNative', {go: true}),
      ],
      excused
    )
    expect(verdict.excused.map((r) => r.name)).toEqual(['added-from-a-junit-event', 'TestNative'])
    expect(verdict.real.map((r) => r.name)).toEqual(['native-only'])
  })

  test('a quarantined Go test that aborted the run stays real', () => {
    expect(
      decide([run('pkg', 'TestA', {go: true, aborted: true})], excusedOf([['', 'pkg', 'TestA']])).real
    ).toHaveLength(1)
  })
})

describe('fetchExcusedTests', () => {
  test('sends no module and keeps quarantined and disabled tests per module', async () => {
    const request = jest.fn().mockResolvedValue({
      data: {
        data: {
          attributes: {
            modules: {
              '': {
                suites: {
                  S: {
                    tests: {
                      q: {properties: {quarantined: true, disabled: false, attempt_to_fix: false}},
                      d: {properties: {quarantined: false, disabled: true, attempt_to_fix: false}},
                      fix: {properties: {quarantined: false, disabled: false, attempt_to_fix: true}},
                      odd: {properties: {quarantined: 'true'}},
                    },
                  },
                },
              },
              'native-module': {suites: {S: {tests: {n: {properties: {quarantined: true}}}}}},
            },
          },
        },
      },
    })

    const excused = await fetchExcusedTests(request, {
      repositoryUrl: 'https://github.com/o/r',
      sha: 'abc',
      branch: 'main',
    })

    expect([...excused.get('')!.get('S')!].sort()).toEqual(['d', 'q'])
    expect([...excused.get('native-module')!.get('S')!]).toEqual(['n'])
    const sent = request.mock.calls[0][0]
    expect(sent.url).toBe('/api/v2/test/libraries/test-management/tests')
    expect(sent.data.data.attributes).toEqual({
      repository_url: 'https://github.com/o/r',
      sha: 'abc',
      branch: 'main',
      commit_message: undefined,
    })
  })
})

describe('judge', () => {
  const input = (overrides: Partial<JudgeInput> = {}): JudgeInput => ({
    exitCode: 1,
    reports: [{path: 'reports/r.xml', xml: goReport}],
    invalidReports: [],
    git: {repositoryUrl: 'https://github.com/DataDog/datadog-agent', sha: 'abc'},
    fetch: async () => excusedOf([['', AGENT_SUITE, 'TestKindSuite/TestContainerLifecycleEvents']]),
    ...overrides,
  })

  test('exits 0 when every failure is quarantined', async () => {
    const verdict = await judge(input())
    expect(verdict.exitCode).toBe(0)
    expect(verdict.lines).toContain(
      `Quarantined or disabled, ignored: ${AGENT_SUITE} TestKindSuite/TestContainerLifecycleEvents`
    )
  })

  test.each([
    ['exit code 0', {exitCode: 0}, 0],
    ['an exit code other than 1 (runner error)', {exitCode: 2}, 2],
    ['a killed job', {exitCode: 137}, 137],
    ['a report that failed validation', {invalidReports: ['reports/broken.xml']}, 1],
    [
      'a report Datadog drops',
      {reports: [{path: 'x.xml', xml: '<testsuite name=""><testcase name="t"><failure/></testcase></testsuite>'}]},
      1,
    ],
    [
      'no failing testcase',
      {reports: [{path: 'x.xml', xml: '<testsuite name="S"><testcase name="t"/></testsuite>'}]},
      1,
    ],
    ['an unknown commit', {git: {repositoryUrl: 'https://github.com/o/r'}}, 1],
    ['a failed fetch', {fetch: async () => Promise.reject(new Error('403'))}, 1],
    ['nothing quarantined', {fetch: async () => new Map()}, 1],
  ])('keeps the test exit code with %s', async (_, overrides: Partial<JudgeInput>, expected) => {
    const fetch = jest.fn(input().fetch)
    const verdict = await judge(input({fetch, ...overrides}))
    expect(verdict.exitCode).toBe(expected)
  })

  test('excuses the runner-specific "tests failed" exit code instead of 1 when given (Bazel: 3)', async () => {
    expect((await judge(input({exitCode: 3, testFailureExitCode: 3}))).exitCode).toBe(0)
    expect((await judge(input({exitCode: 1, testFailureExitCode: 3}))).exitCode).toBe(1)
    expect((await judge(input({exitCode: 3}))).exitCode).toBe(3)
  })

  test('does not call the API when the verdict is already decided', async () => {
    const fetch = jest.fn()
    await judge(input({exitCode: 2, fetch}))
    await judge(input({invalidReports: ['b.xml'], fetch}))
    expect(fetch).not.toHaveBeenCalled()
  })
})
