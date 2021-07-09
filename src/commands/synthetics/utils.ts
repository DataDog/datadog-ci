import * as fs from 'fs'
import * as path from 'path'
import {URL} from 'url'
import {promisify} from 'util'

import chalk from 'chalk'
import glob from 'glob'

import {getCIMetadata} from '../../helpers/ci'
import {pick} from '../../helpers/utils'

import {formatBackendErrors} from './api'
import {
  APIHelper,
  ConfigOverride,
  ExecutionRule,
  InternalTest,
  MainReporter,
  Payload,
  PollResult,
  Reporter,
  Result,
  Suite,
  Summary,
  TemplateContext,
  TestPayload,
  Trigger,
  TriggerConfig,
  TriggerResponse,
  TriggerResult,
} from './interfaces'
import {Tunnel} from './tunnel'

const POLLING_INTERVAL = 5000 // In ms
const PUBLIC_ID_REGEX = /^[\d\w]{3}-[\d\w]{3}-[\d\w]{3}$/
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/

const template = (st: string, context: any): string =>
  st.replace(/{{([A-Z_]+)}}/g, (match: string, p1: string) => (p1 in context ? context[p1] : match))

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
      'tunnel',
      'variables',
    ]),
  }

  if ((test.type === 'browser' || test.subtype === 'http') && config.startUrl) {
    const context = parseUrlVariables(test.config.request.url, reporter)
    handledConfig.startUrl = template(config.startUrl, context)
  }

  return handledConfig
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

export const hasResultPassed = (result: Result): boolean => {
  if (typeof result.passed !== 'undefined') {
    return result.passed
  }

  if (typeof result.errorCode !== 'undefined') {
    return false
  }

  return true
}

export const hasTestSucceeded = (results: PollResult[]): boolean =>
  results.every((pollResult: PollResult) => hasResultPassed(pollResult.result))

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
  triggerResponses: TriggerResponse[],
  defaultTimeout: number,
  triggerConfigs: TriggerConfig[],
  tunnel?: Tunnel
) => {
  const triggerResultMap = createTriggerResultMap(triggerResponses, defaultTimeout, triggerConfigs)
  const triggerResults = [...triggerResultMap.values()]

  const maxPollingTimeout = Math.max(...triggerResults.map((tr) => tr.pollingTimeout))
  const pollingStartDate = new Date().getTime()

  let isTunnelConnected = true
  if (tunnel) {
    tunnel
      .keepAlive()
      .then(() => (isTunnelConnected = false))
      .catch(() => (isTunnelConnected = false))
  }
  while (triggerResults.filter((tr) => !tr.result).length) {
    const pollingDuration = new Date().getTime() - pollingStartDate

    // Remove test which exceeded their pollingTimeout
    for (const triggerResult of triggerResults.filter((tr) => !tr.result)) {
      if (pollingDuration >= triggerResult.pollingTimeout) {
        triggerResult.result = createFailingResult(
          'Timeout',
          triggerResult.result_id,
          triggerResult.device,
          triggerResult.location,
          !!tunnel
        )
      }
    }

    if (tunnel && !isTunnelConnected) {
      for (const triggerResult of triggerResults.filter((tr) => !tr.result)) {
        triggerResult.result = createFailingResult(
          'Tunnel Failure',
          triggerResult.result_id,
          triggerResult.device,
          triggerResult.location,
          !!tunnel
        )
      }
    }

    if (pollingDuration >= maxPollingTimeout) {
      break
    }

    const polledResultsResponse = await api.pollResults(
      triggerResults.filter((tr) => !tr.result).map((tr) => tr.result_id)
    )
    for (const polledResult of polledResultsResponse.results) {
      if (polledResult.result.eventType === 'finished') {
        const triggeredResult = triggerResultMap.get(polledResult.resultID)
        if (triggeredResult) {
          triggeredResult.result = polledResult
        }
      }
    }

    if (!triggerResults.filter((tr) => !tr.result).length) {
      break
    }

    await wait(POLLING_INTERVAL)
  }

  // Bundle results by public id
  return triggerResults.reduce((resultsByPublicId, triggerResult) => {
    const result = triggerResult.result! // The result exists, as either polled or filled with a timeout result
    resultsByPublicId[triggerResult.public_id] = [...(resultsByPublicId[triggerResult.public_id] || []), result]

    return resultsByPublicId
  }, {} as {[key: string]: PollResult[]})
}

export const createTriggerResultMap = (
  triggerResponses: TriggerResponse[],
  defaultTimeout: number,
  triggerConfigs: TriggerConfig[]
): Map<string, TriggerResult> => {
  const timeoutByPublicId: {[key: string]: number} = {}
  for (const trigger of triggerConfigs) {
    timeoutByPublicId[trigger.id] = trigger.config.pollingTimeout ?? defaultTimeout
  }

  const triggerResultMap = new Map()
  for (const triggerResponse of triggerResponses) {
    triggerResultMap.set(triggerResponse.result_id, {
      ...triggerResponse,
      pollingTimeout: timeoutByPublicId[triggerResponse.public_id] ?? defaultTimeout,
    })
  }

  return triggerResultMap
}

const createFailingResult = (
  errorMessage: string,
  resultId: string,
  deviceId: string,
  dcId: number,
  tunnel: boolean
): PollResult => ({
  dc_id: dcId,
  result: {
    device: {height: 0, id: deviceId, width: 0},
    error: errorMessage,
    eventType: 'finished',
    passed: false,
    stepDetails: [],
    tunnel,
  },
  resultID: resultId,
  timestamp: 0,
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
})

export const getTestsToTrigger = async (api: APIHelper, triggerConfigs: TriggerConfig[], reporter: MainReporter) => {
  const overriddenTestsToTrigger: TestPayload[] = []
  const errorMessages: string[] = []
  const summary: Summary = {failed: 0, notFound: 0, passed: 0, skipped: 0}

  const tests = await Promise.all(
    triggerConfigs.map(async ({config, id, suite}) => {
      let test: InternalTest | undefined
      id = PUBLIC_ID_REGEX.test(id) ? id : id.substr(id.lastIndexOf('/') + 1)
      try {
        test = {
          ...(await api.getTest(id)),
          suite,
        }
      } catch (e) {
        summary.notFound++
        const errorMessage = formatBackendErrors(e)
        errorMessages.push(`[${chalk.bold.dim(id)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}\n`)

        return
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
    throw new Error('No tests to trigger')
  }

  return {tests: tests.filter(definedTypeGuard), overriddenTestsToTrigger, summary}
}

export const runTests = async (api: APIHelper, testsToTrigger: TestPayload[]): Promise<Trigger> => {
  const payload: Payload = {tests: testsToTrigger}
  const ciMetadata = getCIMetadata()
  if (ciMetadata) {
    payload.metadata = ciMetadata
  }

  try {
    return api.triggerTests(payload)
  } catch (e) {
    const errorMessage = formatBackendErrors(e)
    const testIds = testsToTrigger.map((t) => t.public_id).join(',')
    // Rewrite error message
    throw new Error(`[${testIds}] Failed to trigger tests: ${errorMessage}\n`)
  }
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
