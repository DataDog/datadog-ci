import * as fs from 'fs'
import * as path from 'path'
import {URL} from 'url'
import {promisify} from 'util'

import chalk from 'chalk'
import glob from 'glob'

import {getCIMetadata} from '../../helpers/ci'
import {pick} from '../../helpers/utils'

import {APIHelper, EndpointError, formatBackendErrors, is5xxError, isNotFoundError, PollResult} from './api'
import {CiError} from './errors'
import {
  ConfigOverride,
  ExecutionRule,
  InternalTest,
  MainReporter,
  Payload,
  Reporter,
  Result,
  Suite,
  Summary,
  SyntheticsCIConfig,
  TemplateContext,
  TemplateVariables,
  Test,
  TestPayload,
  TriggerConfig,
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
  test: InternalTest,
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

export const getExecutionRule = (test: InternalTest, configOverride?: ConfigOverride): ExecutionRule => {
  if (configOverride && configOverride.executionRule) {
    return getStrictestExecutionRule(configOverride.executionRule, test.options?.ci?.executionRule)
  }

  return test.options?.ci?.executionRule || ExecutionRule.BLOCKING
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

export const hasResultPassed = (result: Result, failOnCriticalErrors?: boolean, failOnTimeout?: boolean): boolean => {
  if (!result.result) {
    return true
  }

  if (result.result.unhealthy && !failOnCriticalErrors) {
    return true
  }

  if (result.timedOut && !failOnTimeout) {
    return true
  }

  return result.result.passed
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
  results: Result[],
  timeoutByPublicId: {[key: string]: number},
  options: {failOnCriticalErrors?: boolean; failOnTimeout?: boolean},
  reporter: MainReporter,
  tunnel?: Tunnel
) => {
  let isTunnelConnected = true
  if (tunnel) {
    tunnel
      .keepAlive()
      .then(() => (isTunnelConnected = false))
      .catch(() => (isTunnelConnected = false))
  }

  const resultMap = results.reduce<{[key: string]: Result}>((obj, result) => {
    obj[result.id] = result

    return obj
  }, {})
  const maxPollingTimeout = Math.max(...Object.values(timeoutByPublicId))
  const pollingStartDate = new Date().getTime()
  while (results.some((r) => r.isInProgress)) {
    const pollingDuration = new Date().getTime() - pollingStartDate

    const inProgressResults = results.filter((r) => r.isInProgress)
    // Check for timeout results.
    for (const result of inProgressResults) {
      if (pollingDuration >= timeoutByPublicId[result.testId]) {
        result.error = 'Timeout'
        result.isInProgress = false
        result.timedOut = true
      }
    }

    if (tunnel && !isTunnelConnected) {
      for (const result of inProgressResults) {
        result.isInProgress = false
        result.error = 'Tunnel Failure'
      }
    }

    if (pollingDuration >= maxPollingTimeout) {
      break
    }

    let pollResults: PollResult[] = []
    try {
      pollResults = await api.pollResults(inProgressResults.map((r) => r.id))
    } catch (error) {
      if (!is5xxError(error) || options.failOnCriticalErrors) {
        throw error
      }
    }

    for (const pollResult of pollResults) {
      if (pollResult.result.eventType === 'finished') {
        const result = resultMap[pollResult.resultID]
        result.isInProgress = false
        result.passed = hasResultPassed(result, options.failOnCriticalErrors, options.failOnTimeout)
        result.test = pollResult.check
        result.timestamp = pollResult.timestamp
        result.result = pollResult.result
        reporter.testResult(result)
      }
    }

    await wait(POLLING_INTERVAL)
  }
}

export const createSummary = (): Summary => ({
  criticalErrors: 0,
  failed: 0,
  passed: 0,
  skipped: 0,
  testsNotFound: new Set(),
  timedOut: 0,
})

export const getResultDuration = (result: Result): number => {
  if (result.result && 'duration' in result.result) {
    return Math.round(result.result.duration)
  }

  if (result.result && 'timings' in result.result) {
    return Math.round(result.result.timings.total)
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
  runEnd: (summary) => {
    for (const reporter of reporters) {
      if (typeof reporter.runEnd === 'function') {
        reporter.runEnd(summary)
      }
    }
  },
  testEnd: (test, results, baseUrl, locationNames) => {
    for (const reporter of reporters) {
      if (typeof reporter.testEnd === 'function') {
        reporter.testEnd(test, results, baseUrl, locationNames)
      }
    }
  },
  testResult: (result) => {
    for (const reporter of reporters) {
      if (typeof reporter.testResult === 'function') {
        reporter.testResult(result)
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
      let test: InternalTest | undefined
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

export const runTests = async (api: APIHelper, testsToTrigger: TestPayload[]) => {
  const payload: Payload = {tests: testsToTrigger}
  const ciMetadata = getCIMetadata()

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
