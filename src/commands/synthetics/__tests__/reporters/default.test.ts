import chalk from 'chalk'

import {BaseContext} from 'clipanion/lib/advanced'
import deepExtend from 'deep-extend'

import {ConfigOverride, ExecutionRule, LocationsMapping, MainReporter, Summary, Test} from '../../interfaces'
import {DefaultReporter} from '../../reporters/default'
import {createSummary} from '../../utils'
import {getApiPollResult, getApiTest, mockLocation} from '../fixtures'

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

    const cases: [string, ExecutionRule, ConfigOverride, RegExp][] = [
      [
        'Blocking test, without config overwrite',
        ExecutionRule.BLOCKING,
        {},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\n?$/,
      ],
      [
        'Blocking test, with 1 config override',
        ExecutionRule.BLOCKING,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(1 config override\).*\n?$/,
      ],
      [
        'Blocking test, with 2 config overrides',
        ExecutionRule.BLOCKING,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(2 config overrides\).*\n?$/,
      ],
      [
        'Non-blocking test from Datadog, without config overwrite',
        ExecutionRule.NON_BLOCKING,
        {},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\)\n?$/,
      ],
      [
        'Non-blocking test from Datadog, with 1 config override',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(1 config override\).*\n?$/,
      ],
      [
        'Non-blocking test from Datadog, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(2 config overrides\).*\n?$/,
      ],
      [
        'Non-blocking test, with 1 config override',
        ExecutionRule.NON_BLOCKING,
        {executionRule: ExecutionRule.NON_BLOCKING},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(1 config override\).*\n?$/,
      ],
      [
        'Non-blocking test, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', executionRule: ExecutionRule.NON_BLOCKING},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(2 config overrides\).*\n?$/,
      ],
      [
        'Skipped test, with 1 config override',
        ExecutionRule.SKIPPED,
        {executionRule: ExecutionRule.SKIPPED},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*.*\(1 config override\).*\n?$/,
      ],
      [
        'Skipped test, with 2 config overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', executionRule: ExecutionRule.SKIPPED},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*.*\(2 config overrides\).*\n?$/,
      ],
      [
        'Skipped test from Datadog, without config overwrite',
        ExecutionRule.SKIPPED,
        {},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog\n?$/,
      ],
      [
        'Skipped test from Datadog, with 1 config override',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog.*\(1 config override\).*\n?$/,
      ],
      [
        'Skipped test from Datadog, with 2 config overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog.*\(2 config overrides\).*\n?$/,
      ],
    ]

    test.each(cases)('%s', (title, executionRule, config, expectedOutputPattern) => {
      reporter.testTrigger(testObject, testId, executionRule, config)
      expect(writeMock.mock.calls[0][0]).toMatch(expectedOutputPattern)
    })
  })

  describe('testEnd', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const b = chalk.bold
    const bGreen = chalk.bold.green
    const bYellow = chalk.bold.yellow
    const bRed = chalk.bold.red
    const bDim = chalk.bold.dim

    const firstLineSuccess = (publicId: string) =>
      `${bGreen('✓')} [${bDim(publicId)}] ${b('Test name')} - ${bGreen(`location: ${b(mockLocation.display_name)}`)}`
    const firstLineFailed = (publicId: string) =>
      `${bRed('✖')} [${bRed('blocking')}] [${bDim(publicId)}] ${b('Test name')} - ${bRed(
        `location: ${b(mockLocation.display_name)}`
      )}`
    const firstLineFailedNonBlocking = (publicId: string) =>
      `${bYellow('✖')} [${bYellow('non-blocking')}] [${bDim(publicId)}] ${b('Test name')} - ${bYellow(
        `location: ${b(mockLocation.display_name)}`
      )}`

    const durationWithResultUrl = (resultId: string) =>
      `  ⎋ Total duration: 123 ms - Result URL: ${chalk.dim.cyan(
        `https://app.datadoghq.com/synthetics/details/aaa-aaa-aaa?resultId=${resultId}&from_ci=true`
      )} `

    const apiResultSuccess = `  ${bGreen('✓')} ${bGreen(b('GET') + ' - http://fake.url')}`
    const apiResultFailed = `  ${bRed('✖')} ${bRed(b('GET') + ' - http://fake.url')}`
    const apiResultFailedNonBlocking = `  ${bYellow('✖')} ${bYellow(b('GET') + ' - http://fake.url')}`

    const apiResultFailedAssertions = bRed(
      [
        '  - Assertion(s) failed:',
        `    ▶ responseTime should be less than ${chalk.underline('1000')}. Actual: ${chalk.underline('1234')}`,
      ].join('\n')
    )
    const apiResultFailedNonBlockingAssertions = bYellow(
      [
        '  - Assertion(s) failed:',
        `    ▶ responseTime should be less than ${chalk.underline('1000')}. Actual: ${chalk.underline('1234')}`,
      ].join('\n')
    )

    const createApiPollResult = (resultId: string, passed: boolean, executionRule = ExecutionRule.BLOCKING) => {
      const errorMessage = JSON.stringify([
        {
          actual: 1234,
          operator: 'lessThan',
          target: 1000,
          type: 'responseTime',
        },
      ])
      const failure = {code: 'INCORRECT_ASSERTION', message: errorMessage}

      return deepExtend(getApiPollResult(resultId), {
        enrichment: {config_override: {executionRule}},
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

    const cases = [
      {
        description: '1 API test, 1 location, 1 result: success',
        expectedOutput: [firstLineSuccess('aaa-aaa-aaa'), durationWithResultUrl('1'), apiResultSuccess, '\n'].join(
          '\n'
        ),
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [getApiPollResult('1')],
          test: getApiTest('aaa-aaa-aaa'),
        },
      },
      {
        description: '1 API test (blocking), 1 location, 3 results: success, failed non-blocking, failed',
        expectedOutput: [
          firstLineSuccess('aaa-aaa-aaa'),
          durationWithResultUrl('1'),
          apiResultSuccess,
          '',
          firstLineFailedNonBlocking('aaa-aaa-aaa'),
          durationWithResultUrl('2'),
          apiResultFailedNonBlocking,
          apiResultFailedNonBlockingAssertions,
          '',
          firstLineFailed('aaa-aaa-aaa'),
          durationWithResultUrl('3'),
          apiResultFailed,
          apiResultFailedAssertions,
          '\n',
        ].join('\n'),
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [
            getApiPollResult('1'),
            createApiPollResult('2', false, ExecutionRule.NON_BLOCKING),
            createApiPollResult('3', false),
          ],
          test: getApiTest('aaa-aaa-aaa'),
        },
      },
      {
        description: '1 API test (non-blocking), 1 location, 3 results: success, failed non-blocking, failed',
        expectedOutput: [
          firstLineSuccess('aaa-aaa-aaa'),
          durationWithResultUrl('1'),
          apiResultSuccess,
          '',
          firstLineFailedNonBlocking('aaa-aaa-aaa'),
          durationWithResultUrl('2'),
          apiResultFailedNonBlocking,
          apiResultFailedNonBlockingAssertions,
          '',
          firstLineFailedNonBlocking('aaa-aaa-aaa'),
          durationWithResultUrl('3'),
          apiResultFailedNonBlocking,
          apiResultFailedNonBlockingAssertions,
          '\n',
        ].join('\n'),
        fixtures: {
          baseUrl: baseUrlFixture,
          failOnCriticalErrors: false,
          failOnTimeout: false,
          locationNames: locationNamesFixture,
          results: [
            getApiPollResult('1'),
            createApiPollResult('2', false, ExecutionRule.NON_BLOCKING),
            createApiPollResult('3', false),
          ],
          test: getNonBlockingApiTest('aaa-aaa-aaa'),
        },
      },
    ]

    test.each(cases)('$description', (testCase) => {
      const {test, results, baseUrl, locationNames, failOnCriticalErrors, failOnTimeout} = testCase.fixtures
      reporter.testEnd(test, results, baseUrl, locationNames, failOnCriticalErrors, failOnTimeout)
      expect(writeMock).toHaveBeenCalledWith(testCase.expectedOutput)
    })
  })

  describe('runEnd', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const resultsLabel = chalk.bold('Run summary:')
    const testsNotFound = (n: number, publicIds: string[]) =>
      `${chalk.yellow(`${chalk.bold(n)} test${n !== 1 ? 's' : ''} not found`)} ${chalk.gray(
        `(${publicIds.join(', ')})`
      )}`
    const passed = (n: number) => chalk.green(`${chalk.bold(n)} passed`)
    const failed = (n: number) => chalk.red(`${chalk.bold(n)} failed`)
    const failedNonBlocking = (n: number) => chalk.yellow(`${chalk.bold(n)} failed (non-blocking)`)
    const skipped = (n: number) => `${chalk.bold(n)} skipped`
    const timedOut = (n: number) => chalk.yellow(`${chalk.bold(n)} timed out`)
    const criticaErrors = (n: number) => chalk.red(`${chalk.bold(n)} critical errors`)

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

    const cases: {description: string; expectedOutput: string; summary: Summary}[] = [
      {
        description: 'Simple case with 1 test with 1 result (passed)',
        expectedOutput: `${resultsLabel} ${passed(1)}, ${failed(0)}, ${failedNonBlocking(0)}\n\n`,
        summary: {...baseSummary, passed: 1},
      },
      {
        description: 'Complex case with all the tests and results outcomes possible',
        expectedOutput: [
          testsNotFound(2, ['ccc-ccc-ccc', 'ddd-ddd-ddd']),
          `${resultsLabel} ${passed(2)}, ${failed(1)}, ${failedNonBlocking(3)}, ${skipped(1)} (${timedOut(
            1
          )}, ${criticaErrors(2)})\n\n`,
        ].join('\n'),
        summary: complexSummary,
      },
      {
        description: 'Case where some outcomes are empty or missing',
        expectedOutput: [
          testsNotFound(1, ['bbb-bbb-bbb']),
          `${resultsLabel} ${passed(3)}, ${failed(0)}, ${failedNonBlocking(1)} (${criticaErrors(1)})\n\n`,
        ].join('\n'),
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
      expect(writeMock).toHaveBeenCalledWith(testCase.expectedOutput)
    })
  })
})
