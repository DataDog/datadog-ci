jest.unmock('chalk')

// Force `process.platform` to have the same spinner snapshots on all platforms.
// Without this, `ora` falls back to use a `-` on Windows, resulting in snapshot diffs (`-` instead of `⠋`).
// See https://github.com/sindresorhus/ora#spinner
Object.defineProperty(process, 'platform', {
  value: 'linux',
  configurable: true,
  writable: true,
})

import {BaseContext} from 'clipanion'

import {MOCK_BASE_URL} from '../../../../helpers/__tests__/testing-tools'

import {
  ExecutionRule,
  MainReporter,
  Result,
  SelectiveRerunDecision,
  ServerTest,
  Summary,
  UserConfigOverride,
} from '../../interfaces'
import {DefaultReporter} from '../../reporters/default'
import {isTimedOutRetry} from '../../utils/internal'

import {
  getApiResult,
  getApiTest,
  getBrowserResult,
  getBrowserTest,
  getFailedBrowserResult,
  getIncompleteServerResult,
  getSummary,
  getTimedOutBrowserResult,
} from '../fixtures'

/**
 * A good amount of these tests rely on Jest snapshot assertions.
 * If you make some changes in the output of the default reporter, chances are you
 * will also have to update the snapshots from `./__snapshots__/default.test.ts.snap`.
 * To do that, you can run the following command: `yarn test --updateSnapshot reporters/default.test.ts`.
 * More information on https://jestjs.io/docs/snapshot-testing.
 */

describe('Default reporter', () => {
  const writeMock = jest.fn()
  const mockContext: unknown = {
    context: {
      stdout: {
        write: writeMock,
      },
    },
  }
  const reporter = new DefaultReporter(mockContext as {context: BaseContext})

  afterEach(() => {
    reporter['removeSpinner']()
  })

  it('should log for each hook', () => {
    type ReporterCall = {[Fn in keyof MainReporter]: [Fn, Parameters<MainReporter[Fn]>, number]}[keyof MainReporter]

    // `testWait`/`resultReceived` is skipped as nothing is logged for the default reporter.
    const calls: ReporterCall[] = [
      ['error', ['error'], 1],
      ['initErrors', [['error']], 1],
      ['log', ['log'], 1],
      ['reportStart', [{startTime: 0}], 1],
      ['resultEnd', [getApiResult('1', getApiTest()), '', ''], 1],
      ['runEnd', [getSummary(), ''], 1],
      ['testTrigger', [getApiTest(), '', ExecutionRule.BLOCKING, {}], 1],
      ['testsWait', [[getApiTest()], '', ''], 2],
    ]

    for (const [fnName, args, calledTimes] of calls) {
      ;(reporter[fnName] as any)(...args)
      expect(writeMock).toHaveBeenCalledTimes(calledTimes)
      writeMock.mockClear()
    }
  })

  describe('testTrigger', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const testObject: Pick<ServerTest, 'name'> = {
      name: 'Request on example.org',
    }
    const testId = 'aaa-bbb-ccc'

    const cases: [string, ExecutionRule, UserConfigOverride][] = [
      ['Blocking test, without test override', ExecutionRule.BLOCKING, {}],
      ['Blocking test, with 1 test override', ExecutionRule.BLOCKING, {startUrl: 'foo'}],
      ['Blocking test, with 2 test overrides', ExecutionRule.BLOCKING, {startUrl: 'foo', body: 'hello'}],
      ['Non-blocking test from Datadog, without test override', ExecutionRule.NON_BLOCKING, {}],
      ['Non-blocking test from Datadog, with 1 test override', ExecutionRule.NON_BLOCKING, {startUrl: 'foo'}],
      [
        'Non-blocking test from Datadog, with 2 test overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', body: 'hello'},
      ],
      [
        'Non-blocking test, with 1 test override',
        ExecutionRule.NON_BLOCKING,
        {executionRule: ExecutionRule.NON_BLOCKING},
      ],
      [
        'Non-blocking test, with 2 test overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', executionRule: ExecutionRule.NON_BLOCKING},
      ],
      ['Skipped test, with 1 test override', ExecutionRule.SKIPPED, {executionRule: ExecutionRule.SKIPPED}],
      [
        'Skipped test, with 2 test overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', executionRule: ExecutionRule.SKIPPED},
      ],
      ['Skipped test from Datadog, without test override', ExecutionRule.SKIPPED, {}],
      ['Skipped test from Datadog, with 1 test override', ExecutionRule.SKIPPED, {startUrl: 'foo'}],
      ['Skipped test from Datadog, with 2 test overrides', ExecutionRule.SKIPPED, {startUrl: 'foo', body: 'hello'}],
    ]

    test.each(cases)('%s', (title, executionRule, testOverrides) => {
      reporter.testTrigger(testObject, testId, executionRule, testOverrides)
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })
  })

  describe('testsWait', () => {
    let initialCiEnv: string | undefined

    beforeAll(() => {
      jest.useFakeTimers()
      initialCiEnv = process.env.CI
    })

    afterAll(() => {
      jest.useRealTimers()
      if (initialCiEnv !== undefined) {
        process.env.CI = initialCiEnv
      } else {
        delete process.env.CI
      }
    })

    test('outputs triggered tests', async () => {
      reporter.testsWait(Array<ServerTest>(11).fill(getApiTest()), MOCK_BASE_URL, '123')
      const output = writeMock.mock.calls.map((c) => c[0]).join('\n')
      expect(output).toMatchSnapshot()
    })

    test('outputs triggered tests with skipped count', async () => {
      reporter.testsWait(Array<ServerTest>(11).fill(getApiTest()), MOCK_BASE_URL, '123', 3)
      const output = writeMock.mock.calls.map((c) => c[0]).join('\n')
      expect(output).toMatchSnapshot()
    })

    /* eslint-disable jest/no-conditional-expect */
    test.each([false, true])('the spinner text is updated and cleared at the end (in CI: %s)', async (inCI) => {
      let simulatedTerminalOutput = ''

      const write = jest.fn().mockImplementation((text: string) => {
        // Ignore show/hide cursor ANSI codes.
        if (text.match(/\u001b\[\?25(l|h)/)) {
          return
        }

        simulatedTerminalOutput += text
      })

      const clearLine = jest.fn().mockImplementation(() => {
        simulatedTerminalOutput = simulatedTerminalOutput.split('\n').slice(0, -1).join('\n')
      })

      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }

      const ttyContext = {
        context: {
          stdout: {
            isTTY: true,
            write,
            clearLine,
            cursorTo: jest.fn(),
            moveCursor: jest.fn(),
          },
        },
      }

      const ttyReporter = new DefaultReporter((ttyContext as unknown) as {context: BaseContext})

      clearLine.mockClear()
      ttyReporter.testsWait([getApiTest('aaa-aaa-aaa'), getApiTest('bbb-bbb-bbb')], MOCK_BASE_URL, '123')
      ttyReporter.testsWait([getApiTest('aaa-aaa-aaa'), getApiTest('bbb-bbb-bbb')], MOCK_BASE_URL, '123')
      // The same text is the same, so the spinner is not updated.
      expect(clearLine).not.toHaveBeenCalled()
      expect(simulatedTerminalOutput).toMatchSnapshot()

      clearLine.mockClear()
      ttyReporter.resultEnd(getApiResult('rid', getApiTest('aaa-aaa-aaa')), MOCK_BASE_URL, '123')
      if (inCI) {
        // In CI the spinner does not spin, so `resultEnd()` has no spinner text to clear.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
      expect(simulatedTerminalOutput).toMatchSnapshot()

      clearLine.mockClear()
      ttyReporter.testsWait([getApiTest('aaa-aaa-aaa')], MOCK_BASE_URL, '123')
      ttyReporter['testWaitSpinner']?.render() // Simulate the next frame for the spinner.
      if (inCI) {
        // In CI, the old text from the spinner is not cleared, so that it's persisted in the CI logs.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
      expect(simulatedTerminalOutput).toMatchSnapshot()

      clearLine.mockClear()
      ttyReporter.testsWait([], MOCK_BASE_URL, '123')
      ttyReporter['testWaitSpinner']?.render() // Simulate the next frame for the spinner.
      if (inCI) {
        // In CI, the old text from the spinner is not cleared, so that it's persisted in the CI logs.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
      expect(simulatedTerminalOutput).toMatchSnapshot()

      // Clean up
      ttyReporter['removeSpinner']()
    })
  })
  /* eslint-enable jest/no-conditional-expect */

  describe('resultEnd', () => {
    const createFakeResult = (
      resultId: string,
      opts: {
        executionRule?: ExecutionRule
        incomplete?: boolean
        passed?: boolean
        retries?: number
        maxRetries?: number
        selectiveRerun?: SelectiveRerunDecision
        timedOut?: boolean
      },
      test: ServerTest
    ): Result => {
      const errorMessage = JSON.stringify([
        {
          actual: 1234,
          operator: 'lessThan',
          target: 1000,
          type: 'responseTime',
        },
      ])
      const failure = {code: 'INCORRECT_ASSERTION', message: errorMessage}

      const {executionRule, incomplete, passed, retries, maxRetries, selectiveRerun, timedOut} = opts

      const result = test.type === 'api' ? getApiResult(resultId, test) : getBrowserResult(resultId, test)

      if (passed !== undefined) {
        result.passed = passed
        result.result = {
          ...result.result,
          ...(passed ? {} : {failure}),
          status: passed ? 'passed' : 'failed',
        }
      } else if (executionRule === ExecutionRule.SKIPPED) {
        delete (result as {result?: unknown}).result
      }

      result.retries = retries ?? 0
      result.maxRetries = maxRetries ?? 0

      if (timedOut) {
        result.timedOut = true
        result.passed = false // `failOnTimeout` is assumed to be true

        if (isTimedOutRetry(result.retries, result.maxRetries, timedOut)) {
          result.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the retry.'}
        } else {
          result.result.failure = {code: 'TIMEOUT', message: 'The batch timed out before receiving the result.'}
        }
      }

      if (executionRule) {
        result.executionRule = executionRule
      }

      if (selectiveRerun) {
        result.selectiveRerun = selectiveRerun
      }

      if (incomplete) {
        result.result = getIncompleteServerResult()
      }

      return result
    }

    const apiTest = getApiTest('aaa-aaa-aaa')
    const browserTest = getBrowserTest('bbb-bbb-bbb')

    const cases = [
      {
        description: '1 API test, 1 location, 1 result: success',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [getApiResult('1', apiTest)],
        },
      },
      {
        description: '1 API test, 1 location, 3 results: success, failed non-blocking, failed blocking',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            createFakeResult('1', {executionRule: ExecutionRule.BLOCKING, passed: true}, apiTest),
            createFakeResult('2', {executionRule: ExecutionRule.NON_BLOCKING, passed: false}, apiTest),
            createFakeResult('3', {executionRule: ExecutionRule.BLOCKING, passed: false}, apiTest),
          ],
        },
      },
      {
        description: '3 Browser tests: failed blocking, timed out, global failure',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            getFailedBrowserResult(),
            getTimedOutBrowserResult(),
            {
              ...getTimedOutBrowserResult(),
              result: {
                id: 'rid',
                finished_at: 0,
                duration: 0,
                failure: {code: 'FAILURE_CODE', message: 'Failure message'},
                status: 'failed',
                start_url: 'https://example.com',
                steps: [],
              },
              timedOut: false,
            },
          ] as Result[],
        },
      },
      {
        description: '3 API tests, 2 passed (1 from previous CI run)',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            createFakeResult('1001', {executionRule: ExecutionRule.BLOCKING, passed: true}, apiTest),
            createFakeResult(
              '0002',
              {
                executionRule: ExecutionRule.SKIPPED,
                selectiveRerun: {decision: 'skip', reason: 'passed', linked_result_id: '0002'},
              },
              apiTest
            ),
            createFakeResult(
              '1003',
              {
                executionRule: ExecutionRule.BLOCKING,
                passed: true,
                selectiveRerun: {decision: 'run', reason: 'edited'}, // was re-run because edited, then it passed
              },
              apiTest
            ),
          ],
        },
      },
      {
        description: 'Retryable test - Usual case: passes after max retries',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            createFakeResult('0', {passed: false, retries: 0, maxRetries: 2}, apiTest),
            createFakeResult('1', {passed: false, retries: 1, maxRetries: 2}, apiTest),
            createFakeResult('2', {passed: true, retries: 2, maxRetries: 2}, apiTest),
          ],
        },
      },
      {
        description: 'Retryable test - Usual case: passes after 1 retry only',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            createFakeResult('0', {passed: false, retries: 0, maxRetries: 2}, apiTest),
            createFakeResult('1', {passed: true, retries: 1, maxRetries: 2}, apiTest),
          ],
        },
      },
      {
        description: 'Retryable test - Edge case: fails, then retry times out',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            // The initial result ID is known from the beginning
            createFakeResult('0', {passed: false, retries: 0, maxRetries: 1}, apiTest),
            // If the retry times out, the result ID stays the same
            createFakeResult('0', {timedOut: true, retries: 0, maxRetries: 1}, apiTest),
          ],
        },
      },
      {
        description: 'Incomplete API and Browser tests - passed and failed',
        fixtures: {
          baseUrl: MOCK_BASE_URL,
          results: [
            createFakeResult('1', {incomplete: true, passed: false}, apiTest),
            createFakeResult('2', {incomplete: true, passed: true}, apiTest),
            createFakeResult('3', {incomplete: true, passed: false}, browserTest),
            createFakeResult('4', {incomplete: true, passed: true}, browserTest),
          ],
        },
      },
    ]

    test.each(cases)('$description', (testCase) => {
      const {results, baseUrl} = testCase.fixtures
      for (const result of results) {
        reporter.resultEnd(result, baseUrl, '123')
      }
      const output = writeMock.mock.calls.map((c) => c[0]).join('')
      expect(output).toMatchSnapshot()
    })
  })

  describe('runEnd', () => {
    beforeEach(() => {
      writeMock.mockClear()
      jest.useFakeTimers()
      reporter.reportStart({startTime: Date.now() - 567890}) // 9m 28s
    })

    const baseSummary: Summary = getSummary()

    const complexSummary: Summary = {
      batchId: 'batch-id',
      testsNotAuthorized: new Set(),
      testsNotFound: new Set(['ccc-ccc-ccc', 'ddd-ddd-ddd']),
      expected: 6, // `.failed` + `.failedNonBlocking` + `.passed`
      failed: 1,
      failedNonBlocking: 3,
      passed: 2,
      // The following fields are additional information, so they do not add to `.expected`.
      criticalErrors: 2,
      previouslyPassed: 1,
      skipped: 1,
      timedOut: 1,
    }

    const cases: {description: string; summary: Summary}[] = [
      {
        description: 'Simple case with 1 test with 1 result (passed)',
        summary: {...baseSummary, passed: 1},
      },
      {
        description: 'Complex case with all the tests and results outcomes possible',
        summary: complexSummary,
      },
      {
        description: 'Case where some outcomes are empty or missing',
        summary: {
          ...baseSummary,
          criticalErrors: 1,
          failedNonBlocking: 1,
          passed: 3,
          testsNotFound: new Set(['bbb-bbb-bbb']),
        },
      },
      {
        description: 'Case with 2 passed results, of which 1 comes from previous CI run',
        summary: {
          ...baseSummary,
          expected: 2,
          passed: 2,
          previouslyPassed: 1,
        },
      },
    ]

    test.each(cases)('$description', (testCase) => {
      reporter.runEnd(testCase.summary, MOCK_BASE_URL)
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })

    const onDemandConcurrencyCaps: {description: string; cap: number}[] = [
      {cap: 0, description: 'does not communicate for uncapped orgs'},
      {cap: 1, description: 'communicates no parallelization (1 test at a time)'},
      {cap: 2, description: 'communicates 2 tests parallelization'},
    ]

    test.each(onDemandConcurrencyCaps)('$description', (testCase) => {
      reporter.runEnd({...baseSummary, passed: 1}, MOCK_BASE_URL, {onDemandConcurrencyCap: testCase.cap})
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })
  })
})
