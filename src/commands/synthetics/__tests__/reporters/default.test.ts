import {BaseContext} from 'clipanion/lib/advanced'
import deepExtend from 'deep-extend'

import {ConfigOverride, ExecutionRule, LocationsMapping, MainReporter, Summary, Test} from '../../interfaces'
import {DefaultReporter} from '../../reporters/default'
import {createSummary} from '../../utils'
import {getApiResult, getApiTest, mockLocation} from '../fixtures'

/**
 * A good amount of these tests rely on Jest snapshot assertions.
 * If you make some changes in the output of the default repoter, chances are you
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
  const reporter: any = new DefaultReporter(mockContext as {context: BaseContext})

  it('should log for each hook', () => {
    // `testWait`/`testResult` is skipped as nothing is logged for the default reporter.
    const calls: [keyof MainReporter, any[]][] = [
      ['error', ['error']],
      ['initErrors', [['error']]],
      ['log', ['log']],
      ['reportStart', [{startTime: 0}]],
      ['runEnd', [createSummary()]],
      ['testEnd', [{options: {}}, [], '', []]],
      ['testTrigger', [{}, '', '', {}]],
      ['testsWait', [[{}]]],
    ]
    for (const [fnName, args] of calls) {
      reporter[fnName](...args)
      expect(writeMock).toHaveBeenCalledTimes(1)
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

    const cases: [string, ExecutionRule, ConfigOverride][] = [
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

  describe('testEnd', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const createApiResult = (resultId: string, passed: boolean, executionRule = ExecutionRule.BLOCKING, test: Test) => {
      const errorMessage = JSON.stringify([
        {
          actual: 1234,
          operator: 'lessThan',
          target: 1000,
          type: 'responseTime',
        },
      ])
      const failure = {code: 'INCORRECT_ASSERTION', message: errorMessage}

      return deepExtend(getApiResult(resultId, test), {
        enrichment: {config_override: {executionRule}},
        passed,
        result: {
          passed,
          ...(!passed ? {failure} : {}),
        },
      })
    }

    const getNonBlockingApiTest = (publicId: string) =>
      deepExtend(getApiTest(publicId), {options: {ci: {executionRule: ExecutionRule.NON_BLOCKING}}})

    const baseUrlFixture = 'https://app.datadoghq.com/'
    const locationNamesFixture: LocationsMapping = {1: mockLocation.display_name}

    const apiTest = getApiTest('aaa-aaa-aaa')
    const nonBlockingApiTest = getNonBlockingApiTest('aaa-aaa-aaa')
    const cases = [
      {
        description: '1 API test, 1 location, 1 result: success',
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [getApiResult('1', apiTest)],
          test: apiTest,
        },
      },
      {
        description: '1 API test (blocking), 1 location, 3 results: success, failed non-blocking, failed',
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [
            getApiResult('1', apiTest),
            createApiResult('2', false, ExecutionRule.NON_BLOCKING, apiTest),
            createApiResult('3', false, undefined, apiTest),
          ],
          test: apiTest,
        },
      },
      {
        description: '1 API test (non-blocking), 1 location, 3 results: success, failed non-blocking, failed',
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [
            getApiResult('1', nonBlockingApiTest),
            createApiResult('2', false, ExecutionRule.NON_BLOCKING, nonBlockingApiTest),
            createApiResult('3', false, undefined, nonBlockingApiTest),
          ],
          test: nonBlockingApiTest,
        },
      },
    ]

    test.each(cases)('$description', (testCase) => {
      const {test, results, baseUrl, locationNames, failOnCriticalErrors, failOnTimeout} = testCase.fixtures
      reporter.testEnd(test, results, baseUrl, locationNames, failOnCriticalErrors, failOnTimeout)
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })
  })

  describe('runEnd', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const baseSummary: Summary = createSummary()

    const complexSummary: Summary = {
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
      reporter.runEnd(testCase.summary)
      const mostRecentOutput = writeMock.mock.calls[writeMock.mock.calls.length - 1][0]
      expect(mostRecentOutput).toMatchSnapshot()
    })
  })
})
