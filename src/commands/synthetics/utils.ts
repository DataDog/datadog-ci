import {exec} from 'child_process'
import deepExtend from 'deep-extend'
import * as fs from 'fs'
import * as path from 'path'
import {URL} from 'url'
import {promisify} from 'util'

import chalk from 'chalk'
import glob from 'glob'
import process from 'process'

import {getCIMetadata} from '../../helpers/ci'
import {GIT_COMMIT_MESSAGE} from '../../helpers/tags'
import {pick} from '../../helpers/utils'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper, isNotFoundError} from './api'
import {MAX_TESTS_TO_TRIGGER} from './command'
import {CiError, CriticalError} from './errors'
import {
  Batch,
  BrowserServerResult,
  CommandConfig,
  ExecutionRule,
  LocationsMapping,
  MainReporter,
  Operator,
  Payload,
  PollResult,
  Reporter,
  Result,
  ResultInBatch,
  ServerResult,
  Suite,
  Summary,
  SyntheticsCIConfig,
  TemplateContext,
  TemplateVariables,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
  UserConfigOverride,
} from './interfaces'
import {uploadApplicationAndOverrideConfig} from './mobile'
import {Tunnel} from './tunnel'

const POLLING_INTERVAL = 5000 // In ms
const PUBLIC_ID_REGEX = /^[\d\w]{3}-[\d\w]{3}-[\d\w]{3}$/
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/
const TEMPLATE_REGEX = /{{\s*([^{}]*?)\s*}}/g

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

const template = (st: string, context: any): string =>
  st.replace(TEMPLATE_REGEX, (match: string, p1: string) => (p1 in context ? context[p1] : match))

export let ciTriggerApp = process.env.DATADOG_SYNTHETICS_CI_TRIGGER_APP || 'npm_package'

export const getOverriddenConfig = (
  test: Test,
  publicId: string,
  reporter: MainReporter,
  config?: UserConfigOverride
): TestPayload => {
  const executionRule = getExecutionRule(test, config)
  let overriddenConfig: TestPayload = {
    executionRule,
    public_id: publicId,
  }

  if (!config || !Object.keys(config).length) {
    return overriddenConfig
  }

  overriddenConfig = {
    ...overriddenConfig,
    ...pick(config, [
      'allowInsecureCertificates',
      'basicAuth',
      'body',
      'bodyType',
      'cookies',
      'defaultStepTimeout',
      'deviceIds',
      'followRedirects',
      'headers',
      'locations',
      'pollingTimeout',
      'retry',
      'startUrlSubstitutionRegex',
      'tunnel',
      'variables',
    ]),
  }

  if ((test.type === 'browser' || test.subtype === 'http') && config.startUrl) {
    const context = parseUrlVariables(test.config.request.url, reporter)
    if (URL_VARIABLES.some((v) => config.startUrl?.includes(v))) {
      reporter.error('[DEPRECATION] The usage of URL variables is deprecated, see explanation in the README\n\n')
    }
    overriddenConfig.startUrl = template(config.startUrl, context)
  }

  return overriddenConfig
}

export const setCiTriggerApp = (source: string): void => {
  ciTriggerApp = source
}

const parseUrlVariables = (url: string, reporter: MainReporter) => {
  const context: TemplateContext = {
    ...process.env,
    URL: url,
  }
  let objUrl
  try {
    objUrl = new URL(url)
  } catch {
    reporter.error(`The start url ${url} contains variables, CI overrides will be ignored\n`)

    return context
  }

  warnOnReservedEnvVarNames(context, reporter)

  const subdomainMatch = objUrl.hostname.match(SUBDOMAIN_REGEX)
  const domain = subdomainMatch ? objUrl.hostname.replace(`${subdomainMatch[1]}.`, '') : objUrl.hostname

  context.DOMAIN = domain
  context.HASH = objUrl.hash
  context.HOST = objUrl.host
  context.HOSTNAME = objUrl.hostname
  context.ORIGIN = objUrl.origin
  context.PARAMS = objUrl.search
  context.PATHNAME = objUrl.pathname
  context.PORT = objUrl.port
  context.PROTOCOL = objUrl.protocol
  context.SUBDOMAIN = subdomainMatch ? subdomainMatch[1] : undefined

  return context
}

const URL_VARIABLES = [
  'DOMAIN',
  'HASH',
  'HOST',
  'HOSTNAME',
  'ORIGIN',
  'PARAMS',
  'PATHNAME',
  'PORT',
  'PROTOCOL',
  'SUBDOMAIN',
] as const

const warnOnReservedEnvVarNames = (context: TemplateContext, reporter: MainReporter) => {
  const reservedVarNames: Set<keyof TemplateVariables> = new Set(URL_VARIABLES)

  const usedEnvVarNames = Object.keys(context).filter((name) => (reservedVarNames as Set<string>).has(name))
  if (usedEnvVarNames.length > 0) {
    const names = usedEnvVarNames.join(', ')
    const plural = usedEnvVarNames.length > 1
    reporter.log(
      `Detected ${names} environment variable${plural ? 's' : ''}. ${names} ${plural ? 'are' : 'is a'} Datadog ` +
        `reserved variable${plural ? 's' : ''} used to parse your original test URL, read more about it on ` +
        'our documentation https://docs.datadoghq.com/synthetics/ci/?tab=apitest#start-url. ' +
        'If you want to override your startUrl parameter using environment variables, ' +
        `use ${plural ? '' : 'a '}different namespace${plural ? 's' : ''}.\n\n`
    )
  }
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

export const hasResultPassed = (
  result: ServerResult,
  hasTimedOut: boolean,
  failOnCriticalErrors: boolean,
  failOnTimeout: boolean
): boolean => {
  if (result.unhealthy && !failOnCriticalErrors) {
    return true
  }

  if (hasTimedOut && !failOnTimeout) {
    return true
  }

  if (typeof result.passed !== 'undefined') {
    return result.passed
  }

  if (typeof result.failure !== 'undefined') {
    return false
  }

  return true
}

export const enum ResultOutcome {
  Passed = 'passed',
  PassedNonBlocking = 'passed-non-blocking', // Mainly used for sorting tests when rendering results
  Failed = 'failed',
  FailedNonBlocking = 'failed-non-blocking',
}

export const getResultOutcome = (result: Result): ResultOutcome => {
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

export const getSuites = async (GLOB: string, reporter: MainReporter): Promise<Suite[]> => {
  reporter.log(`Finding files in ${path.join(process.cwd(), GLOB)}\n`)
  const files: string[] = await promisify(glob)(GLOB)
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

export const wait = async (duration: number) => new Promise((resolve) => setTimeout(resolve, duration))

const getBatch = async (
  api: APIHelper,
  emittedResultIndexes: Set<number>,
  trigger: Trigger,
  reporter: MainReporter
): Promise<Batch> => {
  try {
    const currentBatch = await api.getBatch(trigger.batch_id)
    for (const [index, result] of currentBatch.results.entries()) {
      if (result.status !== 'in_progress' && !emittedResultIndexes.has(index)) {
        emittedResultIndexes.add(index)
        reporter.resultReceived(result)
      }
    }

    return currentBatch
  } catch (e) {
    throw new EndpointError(`Failed to get batch: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}

const getTestByPublicId = (id: string, tests: Test[]): Test => tests.find((t) => t.public_id === id)!

const getPollResultMap = async (api: APIHelper, batch: Batch) => {
  try {
    const pollResults = await api.pollResults(batch.results.map((r) => r.result_id))
    const pollResultMap: {[key: string]: PollResult} = {}
    pollResults.forEach((r) => (pollResultMap[r.resultID] = r))

    return pollResultMap
  } catch (e) {
    throw new EndpointError(`Failed to poll results: ${formatBackendErrors(e)}\n`, e.response?.status)
  }
}

const waitForBatchToFinish = async (
  api: APIHelper,
  maxPollingTimeout: number,
  trigger: Trigger,
  reporter: MainReporter
): Promise<{batch: Batch; hasExceededMaxPollingDate: boolean}> => {
  const maxPollingDate = Date.now() + maxPollingTimeout
  const emittedResultIndexes = new Set<number>()

  let batch = await getBatch(api, emittedResultIndexes, trigger, reporter)
  // In theory polling the batch is enough, but in case something goes wrong backend-side
  // let's add a check to ensure it eventually times out.
  let hasExceededMaxPollingDate = Date.now() >= maxPollingDate
  while (batch.status === 'in_progress' && !hasExceededMaxPollingDate) {
    await wait(POLLING_INTERVAL)
    batch = await getBatch(api, emittedResultIndexes, trigger, reporter)
    hasExceededMaxPollingDate = Date.now() >= maxPollingDate
  }

  return {batch, hasExceededMaxPollingDate}
}

const getResultFromBatch = (
  getLocation: (dcId: string, test: Test) => string,
  hasExceededMaxPollingDate: boolean,
  failOnCriticalErrors: boolean,
  failOnTimeout: boolean,
  pollResultMap: {[key: string]: PollResult},
  resultInBatch: ResultInBatch,
  tests: Test[]
): Result => {
  const pollResult = pollResultMap[resultInBatch.result_id]
  const hasTimeout = resultInBatch.timed_out || (hasExceededMaxPollingDate && resultInBatch.timed_out !== false)
  if (hasTimeout) {
    pollResult.result.failure = {code: 'TIMEOUT', message: 'Result timed out'}
    pollResult.result.passed = false
  }

  const test = getTestByPublicId(resultInBatch.test_public_id, tests)

  return {
    executionRule: resultInBatch.execution_rule,
    location: getLocation(resultInBatch.location, test),
    passed: hasResultPassed(pollResult.result, hasTimeout, failOnCriticalErrors, failOnTimeout),
    result: pollResult.result,
    resultId: resultInBatch.result_id,
    test: deepExtend({}, test, pollResult.check),
    timedOut: hasTimeout,
    timestamp: pollResult.timestamp,
  }
}

export const waitForResults = async (
  api: APIHelper,
  trigger: Trigger,
  tests: Test[],
  options: {
    failOnCriticalErrors?: boolean
    failOnTimeout?: boolean
    maxPollingTimeout: number
  },
  reporter: MainReporter,
  tunnel?: Tunnel
): Promise<Result[]> => {
  let isTunnelConnected = true
  if (tunnel) {
    tunnel
      .keepAlive()
      .then(() => (isTunnelConnected = false))
      .catch(() => (isTunnelConnected = false))
  }

  const {batch, hasExceededMaxPollingDate} = await waitForBatchToFinish(
    api,
    options.maxPollingTimeout,
    trigger,
    reporter
  )

  if (tunnel && !isTunnelConnected) {
    reporter.error('The tunnel has stopped working, this may have affected the results.')
  }

  const locationNames = trigger.locations.reduce<LocationsMapping>((mapping, location) => {
    mapping[location.name] = location.display_name

    return mapping
  }, {})

  const getLocation = (dcId: string, test: Test) => {
    const hasTunnel = !!tunnel && (test.type === 'browser' || test.subtype === 'http')

    return hasTunnel ? 'Tunneled' : locationNames[dcId] || dcId
  }

  const pollResultMap = await getPollResultMap(api, batch)
  const results = batch.results.map((resultInBatch) =>
    getResultFromBatch(
      getLocation,
      hasExceededMaxPollingDate,
      options.failOnCriticalErrors!!,
      options.failOnTimeout!!,
      pollResultMap,
      resultInBatch,
      tests
    )
  )

  return results
}

export type InitialSummary = Omit<Summary, 'batchId'>

export const createInitialSummary = (): InitialSummary => ({
  criticalErrors: 0,
  failed: 0,
  failedNonBlocking: 0,
  passed: 0,
  skipped: 0,
  testsNotFound: new Set(),
  timedOut: 0,
})

export const getResultDuration = (result: ServerResult): number => {
  if ('duration' in result) {
    return Math.round(result.duration)
  }
  if ('timings' in result) {
    return Math.round(result.timings.total)
  }

  return 0
}

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
  resultEnd: (result, baseUrl) => {
    for (const reporter of reporters) {
      if (typeof reporter.resultEnd === 'function') {
        reporter.resultEnd(result, baseUrl)
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
  runEnd: (summary, baseUrl) => {
    for (const reporter of reporters) {
      if (typeof reporter.runEnd === 'function') {
        reporter.runEnd(summary, baseUrl)
      }
    }
  },
  runStart: (trigger) => {
    for (const reporter of reporters) {
      if (typeof reporter.runStart === 'function') {
        reporter.runStart(trigger)
      }
    }
  },
  testTrigger: (test, testId, executionRule, config) => {
    for (const reporter of reporters) {
      if (typeof reporter.testTrigger === 'function') {
        reporter.testTrigger(test, testId, executionRule, config)
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
  testsWait: (tests) => {
    for (const reporter of reporters) {
      if (typeof reporter.testsWait === 'function') {
        reporter.testsWait(tests)
      }
    }
  },
})

const getTest = async (api: APIHelper, {id, suite}: TriggerConfig): Promise<{test: Test} | {errorMessage: string}> => {
  try {
    const test = {
      ...(await api.getTest(id)),
      suite,
    }

    return {test}
  } catch (error) {
    if (isNotFoundError(error)) {
      const errorMessage = formatBackendErrors(error)

      return {errorMessage: `[${chalk.bold.dim(id)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}`}
    }

    throw error
  }
}

export const getTestAndOverrideConfig = async (
  api: APIHelper,
  {config, id, suite}: TriggerConfig,
  reporter: MainReporter,
  summary: InitialSummary
) => {
  const normalizedId = PUBLIC_ID_REGEX.test(id) ? id : id.substr(id.lastIndexOf('/') + 1)

  const testResult = await getTest(api, {config, id: normalizedId, suite})
  if ('errorMessage' in testResult) {
    summary.testsNotFound.add(normalizedId)

    return {errorMessage: testResult.errorMessage}
  }

  const {test} = testResult
  const overriddenConfig = getOverriddenConfig(test, normalizedId, reporter, config)

  reporter.testTrigger(test, normalizedId, overriddenConfig.executionRule, config)
  if (overriddenConfig.executionRule === ExecutionRule.SKIPPED) {
    summary.skipped++
  } else {
    reporter.testWait(test)

    return {overriddenConfig, test}
  }

  return {overriddenConfig}
}

export const isDeviceIdSet = (result: ServerResult): result is Required<BrowserServerResult> =>
  'device' in result && result.device !== undefined

export const getTestsToTrigger = async (
  api: APIHelper,
  triggerConfigs: TriggerConfig[],
  reporter: MainReporter,
  triggerFromSearch?: boolean
) => {
  const errorMessages: string[] = []
  // When too many tests are triggered, if fetched from a search query: simply trim them and show a warning,
  // otherwise: retrieve them and fail later if still exceeding without skipped/missing tests.
  if (triggerConfigs.length > MAX_TESTS_TO_TRIGGER && triggerFromSearch) {
    triggerConfigs.splice(MAX_TESTS_TO_TRIGGER)
    const maxTests = chalk.bold(MAX_TESTS_TO_TRIGGER)
    errorMessages.push(
      chalk.yellow(`More than ${maxTests} tests returned by search query, only the first ${maxTests} were fetched.\n`)
    )
  }

  const initialSummary = createInitialSummary()
  const testsAndConfigsOverride = await Promise.all(
    triggerConfigs.map((triggerConfig) => getTestAndOverrideConfig(api, triggerConfig, reporter, initialSummary))
  )

  const uploadedApplicationByPath: {[applicationFilePath: string]: {applicationId: string; fileName: string}[]} = {}
  for (const {test, overriddenConfig} of testsAndConfigsOverride) {
    if (test && test.type === 'mobile' && overriddenConfig) {
      const {config: userConfigOverride} = triggerConfigs.find(({id}) => id === test.public_id)!
      try {
        await uploadApplicationAndOverrideConfig(
          api,
          test,
          userConfigOverride,
          overriddenConfig,
          uploadedApplicationByPath
        )
      } catch (e) {
        throw new CriticalError('UPLOAD_MOBILE_APPLICATION_TESTS_FAILED', e.message)
      }
    }
  }

  const overriddenTestsToTrigger: TestPayload[] = []
  const waitedTests: Test[] = []
  testsAndConfigsOverride.forEach(({test, errorMessage, overriddenConfig}) => {
    if (errorMessage) {
      errorMessages.push(errorMessage)
    }

    if (overriddenConfig) {
      overriddenTestsToTrigger.push(overriddenConfig)
    }

    if (test) {
      waitedTests.push(test)
    }
  })

  // Display errors at the end of all tests for better visibility.
  reporter.initErrors(errorMessages)

  if (!overriddenTestsToTrigger.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  } else if (overriddenTestsToTrigger.length > MAX_TESTS_TO_TRIGGER) {
    throw new CriticalError(
      'TOO_MANY_TESTS_TO_TRIGGER',
      `Cannot trigger more than ${MAX_TESTS_TO_TRIGGER} tests (received ${triggerConfigs.length})`
    )
  }

  if (waitedTests.length > 0) {
    reporter.testsWait(waitedTests)
  }

  return {tests: waitedTests, overriddenTestsToTrigger, initialSummary}
}

export const runTests = async (api: APIHelper, testsToTrigger: TestPayload[]): Promise<Trigger> => {
  const payload: Payload = {tests: testsToTrigger}
  const tagsToLimit = {
    [GIT_COMMIT_MESSAGE]: 500,
  }
  const ciMetadata = getCIMetadata(tagsToLimit)

  if (ciMetadata) {
    payload.metadata = ciMetadata
  }

  try {
    return await api.triggerTests(payload)
  } catch (e) {
    const errorMessage = formatBackendErrors(e)
    const testIds = testsToTrigger.map((t) => t.public_id).join(',')
    // Rewrite error message
    throw new EndpointError(`[${testIds}] Failed to trigger tests: ${errorMessage}\n`, e.response?.status)
  }
}

export const fetchTest = async (publicId: string, config: SyntheticsCIConfig): Promise<Test> => {
  const apiHelper = getApiHelper(config)

  return apiHelper.getTest(publicId)
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

export const parseVariablesFromCli = (
  variableArguments: string[] = [],
  logFunction: (log: string) => void
): {[key: string]: string} | undefined => {
  const variables: {[key: string]: string} = {}

  for (const variableArgument of variableArguments) {
    const separatorIndex = variableArgument.indexOf('=')

    if (separatorIndex === -1) {
      logFunction(`Ignoring variable "${variableArgument}" as separator "=" was not found`)
      continue
    }

    if (separatorIndex === 0) {
      logFunction(`Ignoring variable "${variableArgument}" as variable name is empty`)
      continue
    }

    const key = variableArgument.substring(0, separatorIndex)
    const value = variableArgument.substring(separatorIndex + 1)

    variables[key] = value
  }

  return Object.keys(variables).length > 0 ? variables : undefined
}

export const getAppBaseURL = ({datadogSite, subdomain}: Pick<CommandConfig, 'datadogSite' | 'subdomain'>) =>
  `https://${subdomain}.${datadogSite}/`

export const getBatchUrl = (baseUrl: string, batchId: string) =>
  `${baseUrl}synthetics/explorer/ci?batchResultId=${batchId}`

export const getResultUrl = (baseUrl: string, test: Test, resultId: string) => {
  const ciQueryParam = 'from_ci=true'
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
    [ResultOutcome.PassedNonBlocking]: 1,
    [ResultOutcome.Passed]: 2,
    [ResultOutcome.FailedNonBlocking]: 3,
    [ResultOutcome.Failed]: 4,
  }

  return (r1: Result, r2: Result) => outcomeWeight[getResultOutcome(r1)] - outcomeWeight[getResultOutcome(r2)]
}

export const renderResults = ({
  config,
  reporter,
  results,
  startTime,
  summary,
}: {
  config: CommandConfig
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

  let hasSucceeded = true // Determine if all the tests have succeeded

  const sortedResults = results.sort(sortResultsByOutcome())

  for (const result of sortedResults) {
    if (!config.failOnTimeout && result.timedOut) {
      summary.timedOut++
    }

    if (result.result.unhealthy && !config.failOnCriticalErrors) {
      summary.criticalErrors++
    }

    const resultOutcome = getResultOutcome(result)

    if ([ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)) {
      summary.passed++
    } else if (resultOutcome === ResultOutcome.FailedNonBlocking) {
      summary.failedNonBlocking++
    } else {
      summary.failed++
      hasSucceeded = false
    }

    reporter.resultEnd(result, getAppBaseURL(config))
  }

  reporter.runEnd(summary, getAppBaseURL(config))

  return hasSucceeded ? 0 : 1
}

export const getDatadogHost = (hostConfig: {
  apiVersion: 'v1' | 'unstable'
  config: SyntheticsCIConfig
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
