jest.unmock('chalk')

import {BaseContext} from 'clipanion/lib/advanced'

import {ExecutionRule, MainReporter, Result, Summary, Test, UserConfigOverride} from '../../interfaces'
import {DefaultReporter} from '../../reporters/default'
import {DEFAULT_COMMAND_CONFIG} from '../../run-tests-command'

import {
  getApiResult,
  getApiTest,
  getFailedBrowserResult,
  getSummary,
  getTimedOutBrowserResult,
  MOCK_BASE_URL,
} from '../fixtures'

/**
 * A good amount of these tests rely on Jest snapshot assertions.
 * If you make some changes in the output of the default reporter, chances are you
 * will also have to update the snapshots from `./__snapshots__/default.test.ts.snap`.
 * To do that, you can run the following command: `yarn test --updateSnapshot reporters/default.test.ts`.
 * More information on https://jestjs.io/docs/snapshot-testing.
 */

describe('Default reporter', () => {
  const baseUrlFixture = 'https://app.datadoghq.com/'
  const writeMock = jest.fn()
  const mockContext: unknown = {
    context: {
      stdout: {
        write: writeMock,
      },
    },
  }
  const reporter = new DefaultReporter(mockContext as {context: BaseContext})

  it('should log for each hook', () => {
    type ReporterCall = {[Fn in keyof MainReporter]: [Fn, Parameters<MainReporter[Fn]>, number]}[keyof MainReporter]

    // `testWait`/`resultReceived` is skipped as nothing is logged for the default reporter.
    const calls: ReporterCall[] = [
      ['error', ['error'], 1],
      ['initErrors', [['error']], 1],
      ['log', ['log'], 1],
      ['reportStart', [{startTime: 0}], 1],
      ['resultEnd', [getApiResult('1', getApiTest()), ''], 1],
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

    const testObject: Pick<Test, 'name'> = {
      name: 'Request on example.org',
    }
    const testId = 'aaa-bbb-ccc'

    const cases: [string, ExecutionRule, UserConfigOverride][] = [
      ['Blocking test, without config overwrite', ExecutionRule.BLOCKING, {}],
      ['Blocking test, with 1 config override', ExecutionRule.BLOCKING, {startUrl: 'foo'}],
      ['Blocking test, with 2 config overrides', ExecutionRule.BLOCKING, {startUrl: 'foo', body: 'hello'}],
      ['Non-blocking test from Datadog, without config overwrite', ExecutionRule.NON_BLOCKING, {}],
      ['Non-blocking test from Datadog, with 1 config override', ExecutionRule.NON_BLOCKING, {startUrl: 'foo'}],
      [
        'Non-blocking test from Datadog, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', body: 'hello'},
      ],
      [
        'Non-blocking test, with 1 config override',
        ExecutionRule.NON_BLOCKING,
        {executionRule: ExecutionRule.NON_BLOCKING},
      ],
      [
        'Non-blocking test, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', executionRule: ExecutionRule.NON_BLOCKING},
      ],
      ['Skipped test, with 1 config override', ExecutionRule.SKIPPED, {executionRule: ExecutionRule.SKIPPED}],
      [
        'Skipped test, with 2 config overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', executionRule: ExecutionRule.SKIPPED},
      ],
      ['Skipped test from Datadog, without config overwrite', ExecutionRule.SKIPPED, {}],
      ['Skipped test from Datadog, with 1 config override', ExecutionRule.SKIPPED, {startUrl: 'foo'}],
      ['Skipped test from Datadog, with 2 config overrides', ExecutionRule.SKIPPED, {startUrl: 'foo', body: 'hello'}],
    ]

    test.each(cases)('%s', (title, executionRule, config) => {
      reporter.testTrigger(testObject, testId, executionRule, config)
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })
  })

  test('testsWait outputs triggered tests', async () => {
    reporter.testsWait(new Array(11).fill(getApiTest()), baseUrlFixture, '123')
    const output = writeMock.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toMatchSnapshot()
  })

  describe('resultEnd', () => {
    const createApiResult = (
      resultId: string,
      passed: boolean,
      executionRule = ExecutionRule.BLOCKING,
      test: Test
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

      const result = getApiResult(resultId, test)

      result.executionRule = executionRule
      result.passed = passed
      result.result = {...result.result, ...(passed ? {} : {failure}), passed}

      return result
    }

    const apiTest = getApiTest('aaa-aaa-aaa')
    const cases = [
      {
        description: '1 API test, 1 location, 1 result: success',
        fixtures: {
          baseUrl: baseUrlFixture,
          results: [getApiResult('1', apiTest)],
        },
      },
      {
        description: '1 API test, 1 location, 3 results: success, failed non-blocking, failed blocking',
        fixtures: {
          baseUrl: baseUrlFixture,
          results: [
            createApiResult('1', true, ExecutionRule.BLOCKING, apiTest),
            createApiResult('2', false, ExecutionRule.NON_BLOCKING, apiTest),
            createApiResult('3', false, ExecutionRule.BLOCKING, apiTest),
          ],
        },
      },
      {
        description: '3 Browser test: failed blocking, timed out, global failure',
        fixtures: {
          baseUrl: baseUrlFixture,
          results: [
            getFailedBrowserResult(),
            getTimedOutBrowserResult(),
            {
              ...getTimedOutBrowserResult(),
              result: {
                duration: 0,
                failure: {code: 'FAILURE_CODE', message: 'Failure message'},
                passed: false,
                steps: [],
              },
              timedOut: false,
            },
          ],
        },
      },
    ]

    test.each(cases)('$description', (testCase) => {
      const {results, baseUrl} = testCase.fixtures
      for (const result of results) {
        reporter.resultEnd(result, baseUrl)
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
      criticalErrors: 2,
      failed: 1,
      failedNonBlocking: 3,
      passed: 2,
      skipped: 1,
      testsNotFound: new Set(['ccc-ccc-ccc', 'ddd-ddd-ddd']),
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
