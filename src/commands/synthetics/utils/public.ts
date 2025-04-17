import {exec} from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import process from 'process'
import {promisify} from 'util'

import chalk from 'chalk'
import {globSync} from 'glob'

import {getCommonAppBaseURL} from '../../../helpers/app'

import {formatBackendErrors, getApiHelper} from '../api'
import {CiError, CriticalError} from '../errors'
import {
  APIHelperConfig,
  BrowserServerResult,
  ExecutionRule,
  MainReporter,
  Operator,
  Reporter,
  Result,
  ResultSkippedBySelectiveRerun,
  RunTestsCommandConfig,
  ServerResult,
  Suite,
  Summary,
  SyntheticsCIConfig,
  SyntheticsOrgSettings,
  Test,
  TestPayload,
  TriggerConfig,
  UserConfigOverride,
} from '../interfaces'

import {
  LOCAL_TEST_DEFINITION_PUBLIC_ID_PLACEHOLDER,
  hasDefinedResult,
  getBasePayload,
  isLocalTriggerConfig,
  wait,
} from './internal'

export const PUBLIC_ID_REGEX = /\b[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}\b/

export const readableOperation: {[key in Operator]: string} = {
  [Operator.contains]: 'should contain',
  [Operator.doesNotContain]: 'should not contain',
  [Operator.is]: 'should be',
  [Operator.isNot]: 'should not be',
  [Operator.lessThan]: 'should be less than',
  [Operator.matches]: 'should match',
  [Operator.doesNotMatch]: 'should not match',
  [Operator.isInLessThan]: 'will expire in less than',
  [Operator.isInMoreThan]: 'will expire in more than',
  [Operator.lessThanOrEqual]: 'should be less than or equal to',
  [Operator.moreThan]: 'should be more than',
  [Operator.moreThanOrEqual]: 'should be less than or equal to',
  [Operator.validatesJSONPath]: 'assert on JSONPath extracted value',
  [Operator.validatesXPath]: 'assert on XPath extracted value',
}

export let ciTriggerApp = process.env.DATADOG_SYNTHETICS_CI_TRIGGER_APP || 'npm_package'

export const makeTestPayload = (test: Test, triggerConfig: TriggerConfig, publicId: string): TestPayload => {
  if (isLocalTriggerConfig(triggerConfig)) {
    return {
      ...getBasePayload(test, triggerConfig.testOverrides),
      local_test_definition: triggerConfig.localTestDefinition,
    }
  }

  return {
    ...getBasePayload(test, triggerConfig.testOverrides),
    public_id: publicId,
  }
}

export const getTestOverridesCount = (testOverrides: UserConfigOverride) => {
  return Object.keys(testOverrides).reduce((count) => count + 1, 0)
}

export const setCiTriggerApp = (source: string): void => {
  ciTriggerApp = source
}

export const getExecutionRule = (test?: Test, configOverride?: UserConfigOverride): ExecutionRule => {
  if (configOverride && configOverride.executionRule) {
    return getStrictestExecutionRule(configOverride.executionRule, test?.options?.ci?.executionRule)
  }

  return test?.options?.ci?.executionRule || ExecutionRule.BLOCKING
}

export const getStrictestExecutionRule = (configRule: ExecutionRule, testRule?: ExecutionRule): ExecutionRule => {
  if (configRule === ExecutionRule.SKIPPED || testRule === ExecutionRule.SKIPPED) {
    return ExecutionRule.SKIPPED
  }

  if (configRule === ExecutionRule.NON_BLOCKING || testRule === ExecutionRule.NON_BLOCKING) {
    return ExecutionRule.NON_BLOCKING
  }

  if (configRule === ExecutionRule.BLOCKING || testRule === ExecutionRule.BLOCKING) {
    return ExecutionRule.BLOCKING
  }

  return ExecutionRule.BLOCKING
}

export const isTestSupportedByTunnel = (test: Test) => {
  // Test public IDs are required by the tunnel.
  if (!test.public_id) {
    return false
  }

  return (
    test.type === 'browser' ||
    test.subtype === 'http' ||
    (test.subtype === 'multi' && test.config.steps?.every((step) => step.subtype === 'http'))
  )
}

export const enum ResultOutcome {
  Passed = 'passed',
  PreviouslyPassed = 'previously-passed',
  PassedNonBlocking = 'passed-non-blocking',
  Failed = 'failed',
  FailedNonBlocking = 'failed-non-blocking',
}

export const PASSED_RESULT_OUTCOMES = [
  ResultOutcome.Passed,
  ResultOutcome.PassedNonBlocking,
  ResultOutcome.PreviouslyPassed,
]

export const getResultOutcome = (result: Result): ResultOutcome => {
  if (isResultSkippedBySelectiveRerun(result)) {
    return ResultOutcome.PreviouslyPassed
  }

  const executionRule = result.executionRule

  if (result.passed) {
    if (executionRule === ExecutionRule.NON_BLOCKING) {
      return ResultOutcome.PassedNonBlocking
    }

    return ResultOutcome.Passed
  }

  if (executionRule === ExecutionRule.NON_BLOCKING) {
    return ResultOutcome.FailedNonBlocking
  }

  return ResultOutcome.Failed
}

export const getSuites = async (pattern: string, reporter: MainReporter): Promise<Suite[]> => {
  reporter.log(`Finding files matching ${path.resolve(process.cwd(), pattern)}\n`)

  const files: string[] = globSync(pattern)
  if (files.length) {
    reporter.log(`\nGot test files:\n${files.map((file) => `  - ${file}\n`).join('')}\n`)
  } else {
    reporter.log('\nNo test files found.\n\n')
  }

  return Promise.all(
    files.map(async (file) => {
      try {
        const content = await promisify(fs.readFile)(file, 'utf8')
        const suiteName = await getFilePathRelativeToRepo(file)

        return {name: suiteName, content: JSON.parse(content)}
      } catch (e) {
        throw new Error(`Unable to read and parse the test file ${file}`)
      }
    })
  )
}

export const getFilePathRelativeToRepo = async (filePath: string) => {
  const parentDirectory = path.dirname(filePath)
  const filename = path.basename(filePath)

  let relativeDirectory: string

  try {
    const {stdout} = await promisify(exec)('git rev-parse --show-toplevel')
    const repoTopLevel = stdout.trim()
    relativeDirectory = path.relative(repoTopLevel, parentDirectory)
  } catch {
    // We aren't in a git repository: fall back to the given path, relative to the process working directory.
    relativeDirectory = path.relative(process.cwd(), parentDirectory)
  }

  return path.join(relativeDirectory, filename)
}

export const normalizePublicId = (id: string): string | undefined =>
  id === LOCAL_TEST_DEFINITION_PUBLIC_ID_PLACEHOLDER ? id : id.match(PUBLIC_ID_REGEX)?.[0]

export const getOrgSettings = async (
  reporter: MainReporter,
  config: SyntheticsCIConfig
): Promise<SyntheticsOrgSettings | undefined> => {
  const api = getApiHelper(config)

  try {
    return await api.getSyntheticsOrgSettings()
  } catch (e) {
    reporter.error(`Failed to get settings: ${formatBackendErrors(e, 'synthetics_default_settings_read')}`)
  }
}

export const isResultSkippedBySelectiveRerun = (result: Result): result is ResultSkippedBySelectiveRerun => {
  return result.selectiveRerun?.decision === 'skip'
}

export type InitialSummary = Omit<Summary, 'batchId'>

export const createInitialSummary = (): InitialSummary => ({
  criticalErrors: 0,
  expected: 0,
  failed: 0,
  failedNonBlocking: 0,
  passed: 0,
  previouslyPassed: 0,
  skipped: 0,
  testsNotFound: new Set(),
  timedOut: 0,
})

export const getReporter = (reporters: Reporter[]): MainReporter => ({
  error: (error) => {
    for (const reporter of reporters) {
      if (typeof reporter.error === 'function') {
        reporter.error(error)
      }
    }
  },
  initErrors: (errors) => {
    for (const reporter of reporters) {
      if (typeof reporter.initErrors === 'function') {
        reporter.initErrors(errors)
      }
    }
  },
  log: (log) => {
    for (const reporter of reporters) {
      if (typeof reporter.log === 'function') {
        reporter.log(log)
      }
    }
  },
  reportStart: (timings) => {
    for (const reporter of reporters) {
      if (typeof reporter.reportStart === 'function') {
        reporter.reportStart(timings)
      }
    }
  },
  resultEnd: (result, baseUrl, batchId) => {
    for (const reporter of reporters) {
      if (typeof reporter.resultEnd === 'function') {
        reporter.resultEnd(result, baseUrl, batchId)
      }
    }
  },
  resultReceived: (result) => {
    for (const reporter of reporters) {
      if (typeof reporter.resultReceived === 'function') {
        reporter.resultReceived(result)
      }
    }
  },
  runEnd: (summary, baseUrl, orgSettings) => {
    for (const reporter of reporters) {
      if (typeof reporter.runEnd === 'function') {
        reporter.runEnd(summary, baseUrl, orgSettings)
      }
    }
  },
  testTrigger: (test, testId, executionRule, testOverrides) => {
    for (const reporter of reporters) {
      if (typeof reporter.testTrigger === 'function') {
        reporter.testTrigger(test, testId, executionRule, testOverrides)
      }
    }
  },
  testWait: (test) => {
    for (const reporter of reporters) {
      if (typeof reporter.testWait === 'function') {
        reporter.testWait(test)
      }
    }
  },
  testsWait: (tests, baseUrl, batchId, skippedCount) => {
    for (const reporter of reporters) {
      if (typeof reporter.testsWait === 'function') {
        reporter.testsWait(tests, baseUrl, batchId, skippedCount)
      }
    }
  },
})

export const isDeviceIdSet = (result: ServerResult): result is Required<BrowserServerResult> =>
  'device' in result && result.device !== undefined

export const fetchTest = async (publicId: string, config: SyntheticsCIConfig): Promise<Test> => {
  const api = getApiHelper(config)

  return api.getTest(publicId)
}

export const retry = async <T, E extends Error>(
  func: () => Promise<T>,
  shouldRetryAfterWait: (retries: number, error: E) => number | undefined
): Promise<T> => {
  const trier = async (retries = 0): Promise<T> => {
    try {
      return await func()
    } catch (e) {
      const waiter = shouldRetryAfterWait(retries, e)
      if (waiter) {
        await wait(waiter)

        return trier(retries + 1)
      }
      throw e
    }
  }

  return trier()
}

export const getAppBaseURL = ({datadogSite, subdomain}: {datadogSite: string; subdomain: string}) => {
  return getCommonAppBaseURL(datadogSite, subdomain)
}

export const getBatchUrl = (baseUrl: string, batchId: string) =>
  `${baseUrl}synthetics/explorer/ci?batchResultId=${batchId}`

export const getResultUrl = (baseUrl: string, test: Test, resultId: string, batchId: string) => {
  const ciQueryParam = `batch_id=${batchId}&from_ci=true`
  const testDetailUrl = `${baseUrl}synthetics/details/${test.public_id}`
  if (test.type === 'browser') {
    return `${testDetailUrl}/result/${resultId}?${ciQueryParam}`
  }

  return `${testDetailUrl}?resultId=${resultId}&${ciQueryParam}`
}

/**
 * Sort results with the following rules:
 * - Passed results come first
 * - Then non-blocking failed results
 * - And finally failed results
 */
export const sortResultsByOutcome = () => {
  const outcomeWeight = {
    [ResultOutcome.PreviouslyPassed]: 1,
    [ResultOutcome.PassedNonBlocking]: 2,
    [ResultOutcome.Passed]: 3,
    [ResultOutcome.FailedNonBlocking]: 4,
    [ResultOutcome.Failed]: 5,
  }

  return (r1: Result, r2: Result) => outcomeWeight[getResultOutcome(r1)] - outcomeWeight[getResultOutcome(r2)]
}

export const renderResults = ({
  config,
  orgSettings,
  reporter,
  results,
  startTime,
  summary,
}: {
  config: RunTestsCommandConfig
  orgSettings: SyntheticsOrgSettings | undefined
  reporter: MainReporter
  results: Result[]
  startTime: number
  summary: Summary
}) => {
  reporter.reportStart({startTime})

  if (!config.failOnTimeout) {
    if (!summary.timedOut) {
      summary.timedOut = 0
    }
  }

  if (!config.failOnCriticalErrors) {
    if (!summary.criticalErrors) {
      summary.criticalErrors = 0
    }
  }

  for (const result of results) {
    if (!config.failOnTimeout && result.timedOut) {
      summary.timedOut++
    }

    if (hasDefinedResult(result) && result.result.unhealthy && !config.failOnCriticalErrors) {
      summary.criticalErrors++
    }

    const resultOutcome = getResultOutcome(result)

    if (result.executionRule !== ExecutionRule.SKIPPED || resultOutcome === ResultOutcome.PreviouslyPassed) {
      summary.expected++
    }

    if ([ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)) {
      summary.passed++
    } else if (resultOutcome === ResultOutcome.PreviouslyPassed) {
      summary.passed++
      summary.previouslyPassed++
    } else if (resultOutcome === ResultOutcome.FailedNonBlocking) {
      summary.failedNonBlocking++
    } else {
      summary.failed++
    }
  }

  reporter.runEnd(summary, getAppBaseURL(config), orgSettings)
}

export const reportExitLogs = (
  reporter: MainReporter,
  config: Pick<RunTestsCommandConfig, 'failOnTimeout' | 'failOnCriticalErrors'>,
  {results, error}: {results?: Result[]; error?: unknown}
) => {
  if (!config.failOnTimeout && results?.some((result) => result.timedOut)) {
    reporter.error(
      chalk.yellow(
        'Because `failOnTimeout` is disabled, the command will succeed. ' +
          'Use `failOnTimeout: true` to make it fail instead.\n'
      )
    )
  }

  if (!config.failOnCriticalErrors && error instanceof CriticalError) {
    reporter.error(
      chalk.yellow(
        'Because `failOnCriticalErrors` is not set or disabled, the command will succeed. ' +
          'Use `failOnCriticalErrors: true` to make it fail instead.\n'
      )
    )
  }

  if (error instanceof CiError) {
    reportCiError(error, reporter)
  }
}

export const getExitReason = (
  config: Pick<RunTestsCommandConfig, 'failOnCriticalErrors' | 'failOnMissingTests'>,
  {results, error}: {results?: Result[]; error?: unknown}
) => {
  if (results?.some((result) => getResultOutcome(result) === ResultOutcome.Failed)) {
    return 'failing-tests'
  }

  if (error instanceof CiError) {
    // Ensure the command fails if search query starts returning no results
    if (config.failOnMissingTests && ['MISSING_TESTS', 'NO_TESTS_TO_RUN'].includes(error.code)) {
      return 'missing-tests'
    }

    if (error instanceof CriticalError) {
      if (config.failOnCriticalErrors) {
        return 'critical-error'
      }
    }
  }

  return 'passed'
}

export type ExitReason = ReturnType<typeof getExitReason>

export const toExitCode = (reason: ExitReason) => {
  return reason === 'passed' ? 0 : 1
}

export const getDatadogHost = (hostConfig: {
  apiVersion: 'v1' | 'unstable'
  config: APIHelperConfig
  useIntake: boolean
}) => {
  const {useIntake, apiVersion, config} = hostConfig

  const apiPath = apiVersion === 'v1' ? 'api/v1' : 'api/unstable'
  let host = `https://api.${config.datadogSite}`
  const hostOverride = process.env.DD_API_HOST_OVERRIDE

  if (hostOverride) {
    host = hostOverride
  } else if (useIntake && (config.datadogSite === 'datadoghq.com' || config.datadogSite === 'datad0g.com')) {
    host = `https://intake.synthetics.${config.datadogSite}`
  }

  return `${host}/${apiPath}`
}

export const pluralize = (word: string, count: number): string => (count === 1 ? word : `${word}s`)

export const reportCiError = (error: CiError, reporter: MainReporter) => {
  switch (error.code) {
    case 'NO_TESTS_TO_RUN':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: No tests to run ')}\n${error.message}\n\n`)
      break
    case 'MISSING_TESTS':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: some tests are missing ')}\n${error.message}\n\n`)
      break

    // Critical command errors
    case 'AUTHORIZATION_ERROR':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: authorization error ')}\n${error.message}\n\n`)
      reporter.log('Credentials refused, make sure `apiKey`, `appKey` and `datadogSite` are correct.\n')
      break
    case 'INVALID_CONFIG':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: invalid config ')}\n${error.message}\n\n`)
      break
    case 'MISSING_APP_KEY':
      reporter.error(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
      break
    case 'MISSING_API_KEY':
      reporter.error(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      break
    case 'POLL_RESULTS_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${error.message}\n\n`)
      break
    case 'BATCH_TIMEOUT_RUNAWAY':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: batch timeout runaway ')}\n${error.message}\n\n`)
      break
    case 'TUNNEL_START_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to start tunnel ')}\n${error.message}\n\n`)
      break
    case 'TOO_MANY_TESTS_TO_TRIGGER':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: too many tests to trigger ')}\n${error.message}\n\n`)
      break
    case 'TRIGGER_TESTS_FAILED':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to trigger tests ')}\n${error.message}\n\n`)
      break
    case 'UNAVAILABLE_TEST_CONFIG':
      reporter.error(
        `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations with search query ')}\n${error.message}\n\n`
      )
      break
    case 'UNAVAILABLE_TUNNEL_CONFIG':
      reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration ')}\n${error.message}\n\n`)
      break
    case 'LTD_MULTILOCATORS_UPDATE_FAILED':
      reporter.error(
        `\n${chalk.bgRed.bold(' ERROR: unable to update multilocators in local test definition')}\n${error.message}\n\n`
      )
      break

    default:
      reporter.error(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.message}\n\n`)
  }
}
