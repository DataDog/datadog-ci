import deepExtend from 'deep-extend'
import * as fs from 'fs'
import * as path from 'path'
import {URL} from 'url'
import {promisify} from 'util'

import chalk from 'chalk'
import glob from 'glob'

import {getCIMetadata} from '../../helpers/ci'
import {GIT_COMMIT_MESSAGE} from '../../helpers/tags'
import {pick} from '../../helpers/utils'

import {APIHelper, EndpointError, formatBackendErrors, is5xxError, isNotFoundError} from './api'
import {CiError} from './errors'
import {
  ConfigOverride,
  ERRORS,
  ExecutionRule,
  LocationsMapping,
  MainReporter,
  Payload,
  PollResult,
  Reporter,
  Result,
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
  TriggerResponse,
  TriggerResult,
} from './interfaces'
import {getApiHelper} from './run-test'
import {Tunnel} from './tunnel'

const POLLING_INTERVAL = 5000 // In ms
const PUBLIC_ID_REGEX = /^[\d\w]{3}-[\d\w]{3}-[\d\w]{3}$/
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/
const TEMPLATE_REGEX = /{{\s*([^{}]*?)\s*}}/g

const template = (st: string, context: any): string =>
  st.replace(TEMPLATE_REGEX, (match: string, p1: string) => (p1 in context ? context[p1] : match))

export let ciTriggerApp = process.env.DATADOG_SYNTHETICS_CI_TRIGGER_APP || 'npm_package'

export const handleConfig = (
  test: Test,
  publicId: string,
  reporter: MainReporter,
  config?: ConfigOverride
): TestPayload => {
  const executionRule = getExecutionRule(test, config)
  let handledConfig: TestPayload = {
    executionRule,
    public_id: publicId,
  }

  if (!config || !Object.keys(config).length) {
    return handledConfig
  }

  handledConfig = {
    ...handledConfig,
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
    handledConfig.startUrl = template(config.startUrl, context)
  }

  return handledConfig
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

export const getExecutionRule = (test?: Test, configOverride?: ConfigOverride): ExecutionRule => {
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

export const isCriticalError = (result: ServerResult): boolean => result.unhealthy || result.error === ERRORS.ENDPOINT

export const hasResultPassed = (
  result: ServerResult,
  failOnCriticalErrors: boolean,
  failOnTimeout: boolean
): boolean => {
  if (isCriticalError(result) && !failOnCriticalErrors) {
    return true
  }

  if (result.error === ERRORS.TIMEOUT && !failOnTimeout) {
    return true
  }

  if (typeof result.passed !== 'undefined') {
    return result.passed
  }

  if (typeof result.errorCode !== 'undefined') {
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
  const executionRule = getExecutionRule(result.test, result.enrichment?.config_override)

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

        return {name: file, content: JSON.parse(content)}
      } catch (e) {
        throw new Error(`Unable to read and parse the test file ${file}`)
      }
    })
  )
}

export const wait = async (duration: number) => new Promise((resolve) => setTimeout(resolve, duration))

export const waitForResults = async (
  api: APIHelper,
  trigger: Trigger,
  triggerConfigs: TriggerConfig[],
  tests: Test[],
  options: {
    defaultTimeout: number
    failOnCriticalErrors?: boolean
    failOnTimeout?: boolean
  },
  reporter: MainReporter,
  tunnel?: Tunnel
): Promise<Result[]> => {
  const inProgressTriggers = createInProgressTriggers(trigger.results, options.defaultTimeout, triggerConfigs)
  const results: Result[] = []

  const maxPollingTimeout = Math.max(...[...inProgressTriggers].map((tr) => tr.pollingTimeout))

  const pollingStartDate = new Date().getTime()

  let isTunnelConnected = true
  if (tunnel) {
    tunnel
      .keepAlive()
      .then(() => (isTunnelConnected = false))
      .catch(() => (isTunnelConnected = false))
  }

  const locationNames = trigger.locations.reduce<LocationsMapping>((mapping, location) => {
    mapping[location.id] = location.display_name

    return mapping
  }, {})

  const getLocation = (dcId: number, test: Test) => {
    const hasTunnel = !!tunnel && (test.type === 'browser' || test.subtype === 'http')

    return hasTunnel ? 'Tunneled' : locationNames[dcId] || dcId.toString()
  }

  const getTest = (id: string): Test => tests.find((t) => t.public_id === id)!

  while (inProgressTriggers.size) {
    const pollingDuration = new Date().getTime() - pollingStartDate

    // Remove test which exceeded their pollingTimeout
    for (const triggerResult of inProgressTriggers) {
      if (pollingDuration >= triggerResult.pollingTimeout) {
        inProgressTriggers.delete(triggerResult)
        const test = getTest(triggerResult.public_id)
        const result = createFailingResult(
          ERRORS.TIMEOUT,
          triggerResult,
          getLocation(triggerResult.location, test),
          test
        )
        result.passed = hasResultPassed(result.result, options.failOnCriticalErrors!!, options.failOnTimeout!!)
        results.push(result)
      }
    }

    if (tunnel && !isTunnelConnected) {
      for (const triggerResult of inProgressTriggers) {
        inProgressTriggers.delete(triggerResult)
        const test = getTest(triggerResult.public_id)
        results.push(createFailingResult(ERRORS.TUNNEL, triggerResult, getLocation(triggerResult.location, test), test))
      }
    }

    if (pollingDuration >= maxPollingTimeout) {
      break
    }

    let polledResults: PollResult[]
    try {
      polledResults = (await api.pollResults([...inProgressTriggers.values()].map((tr) => tr.result_id))).results
    } catch (error) {
      if (is5xxError(error) && !options.failOnCriticalErrors) {
        polledResults = []
        for (const triggerResult of inProgressTriggers) {
          inProgressTriggers.delete(triggerResult)
          const test = getTest(triggerResult.public_id)
          const result = createFailingResult(
            ERRORS.ENDPOINT,
            triggerResult,
            getLocation(triggerResult.location, test),
            test
          )
          result.passed = hasResultPassed(result.result, options.failOnCriticalErrors!!, options.failOnTimeout!!)
          results.push(result)
        }
      } else {
        throw error
      }
    }

    for (const polledResult of polledResults) {
      if (polledResult.result.eventType === 'finished') {
        const triggeredResult = [...inProgressTriggers.values()].find((r) => r.result_id === polledResult.resultID)
        if (triggeredResult) {
          inProgressTriggers.delete(triggeredResult)
          const test = getTest(triggeredResult.public_id)
          const result: Result = {
            enrichment: polledResult.enrichment,
            location: getLocation(triggeredResult.location, test),
            passed: hasResultPassed(polledResult.result, options.failOnCriticalErrors!!, options.failOnTimeout!!),
            result: polledResult.result,
            resultId: polledResult.resultID,
            test: deepExtend(test, polledResult.check),
            timestamp: polledResult.timestamp,
          }
          results.push(result)
          reporter.resultReceived(result)
        }
      }
    }

    if (!inProgressTriggers.size) {
      break
    }

    await wait(POLLING_INTERVAL)
  }

  return results
}

const createInProgressTriggers = (
  triggerResponses: TriggerResponse[],
  defaultTimeout: number,
  triggerConfigs: TriggerConfig[]
): Set<TriggerResult> => {
  const timeoutByPublicId: {[key: string]: number} = {}
  for (const trigger of triggerConfigs) {
    timeoutByPublicId[trigger.id] = trigger.config.pollingTimeout ?? defaultTimeout
  }

  const inProgressTriggers = new Set<TriggerResult>()

  for (const triggerResponse of triggerResponses) {
    inProgressTriggers.add({
      ...triggerResponse,
      pollingTimeout: timeoutByPublicId[triggerResponse.public_id] ?? defaultTimeout,
    })
  }

  return inProgressTriggers
}

const createFailingResult = (
  errorMessage: ERRORS,
  triggerResult: TriggerResult,
  location: string,
  test: Test
): Result => ({
  location,
  passed: false,
  result: {
    device: {height: 0, id: triggerResult.device, width: 0},
    duration: 0,
    error: errorMessage,
    eventType: 'finished',
    passed: false,
    startUrl: '',
    stepDetails: [],
  },
  resultId: triggerResult.result_id,
  test,
  timestamp: 0,
})

export const createSummary = (): Summary => ({
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
  runEnd: (summary) => {
    for (const reporter of reporters) {
      if (typeof reporter.runEnd === 'function') {
        reporter.runEnd(summary)
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

export const getTestsToTrigger = async (api: APIHelper, triggerConfigs: TriggerConfig[], reporter: MainReporter) => {
  const overriddenTestsToTrigger: TestPayload[] = []
  const errorMessages: string[] = []
  const summary = createSummary()

  const tests = await Promise.all(
    triggerConfigs.map(async ({config, id, suite}) => {
      let test: Test | undefined
      id = PUBLIC_ID_REGEX.test(id) ? id : id.substr(id.lastIndexOf('/') + 1)
      try {
        test = {
          ...(await api.getTest(id)),
          suite,
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          summary.testsNotFound.add(id)
          const errorMessage = formatBackendErrors(error)
          errorMessages.push(`[${chalk.bold.dim(id)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}`)

          return
        }

        throw error
      }

      const overriddenConfig = handleConfig(test, id, reporter, config)
      overriddenTestsToTrigger.push(overriddenConfig)

      reporter.testTrigger(test, id, overriddenConfig.executionRule, config)
      if (overriddenConfig.executionRule === ExecutionRule.SKIPPED) {
        summary.skipped++
      } else {
        reporter.testWait(test)

        return test
      }
    })
  )

  // Display errors at the end of all tests for better visibility.
  reporter.initErrors(errorMessages)

  if (!overriddenTestsToTrigger.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  const waitedTests = tests.filter(definedTypeGuard)
  if (waitedTests.length > 0) {
    reporter.testsWait(waitedTests)
  }

  return {tests: waitedTests, overriddenTestsToTrigger, summary}
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
    throw new EndpointError(`[${testIds}] Failed to trigger tests: ${errorMessage}\n`, e.response.status)
  }
}

export const fetchTest = async (publicId: string, config: SyntheticsCIConfig): Promise<Test> => {
  const apiHelper = getApiHelper(config)

  return apiHelper.getTest(publicId)
}

const definedTypeGuard = <T>(o: T | undefined): o is T => !!o

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
