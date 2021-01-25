import * as fs from 'fs'
import * as path from 'path'
import {Writable} from 'stream'
import {URL} from 'url'
import {promisify} from 'util'

import chalk from 'chalk'
import glob from 'glob'

import {formatBackendErrors} from './api'
import {
  APIHelper,
  ConfigOverride,
  ExecutionRule,
  Payload,
  PollResult,
  Result,
  Suite,
  TemplateContext,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
  TriggerResponse,
  TriggerResult,
} from './interfaces'
import {renderTrigger, renderWait} from './renderer'

import {getCIMetadata} from '../../helpers/ci'
import {pick} from '../../helpers/utils'

const POLLING_INTERVAL = 5000 // In ms
const PUBLIC_ID_REGEX = /^[\d\w]{3}-[\d\w]{3}-[\d\w]{3}$/
const SUBDOMAIN_REGEX = /(.*?)\.(?=[^\/]*\..{2,5})/

const template = (st: string, context: any): string =>
  st.replace(/{{([A-Z_]+)}}/g, (match: string, p1: string) => (p1 in context ? context[p1] : match))

export const handleConfig = (
  test: Test,
  publicId: string,
  write: Writable['write'],
  config?: ConfigOverride
): TestPayload => {
  let handledConfig: Payload = {public_id: publicId}
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
      'deviceIds',
      'followRedirects',
      'headers',
      'locations',
      'pollingTimeout',
      'retry',
      'variables',
    ]),
  }

  const context = parseUrlVariables(test.config.request.url, write)

  if (config.startUrl) {
    handledConfig.startUrl = template(config.startUrl, context)
  }

  if (config.executionRule) {
    const executionRule = getStrictestExecutionRule(config.executionRule, test.options.ci?.executionRule)
    test.options.ci = {...(test.options.ci || {}), executionRule}
  }

  return handledConfig
}

const parseUrlVariables = (url: string, write: Writable['write']) => {
  const context: TemplateContext = {
    ...process.env,
    URL: url,
  }
  let objUrl
  try {
    objUrl = new URL(url)
  } catch {
    write(`The start url ${url} contains variables, CI overrides will be ignored`)

    return context
  }

  const subdomainMatch = objUrl.hostname.match(SUBDOMAIN_REGEX)
  const domain = subdomainMatch ? objUrl.hostname.replace(`${subdomainMatch[1]}.`, '') : objUrl.hostname

  context.DOMAIN = domain
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

export const getSuites = async (GLOB: string, write: Writable['write']): Promise<Suite[]> => {
  write(`Finding files in ${path.join(process.cwd(), GLOB)}\n`)
  const files: string[] = await promisify(glob)(GLOB)
  if (files.length) {
    write(`\nGot test files:\n${files.map((file) => `  - ${file}\n`).join('')}\n`)
  } else {
    write('\nNo test files found.\n\n')
  }

  return Promise.all(
    files.map(async (test) => {
      try {
        const content = await promisify(fs.readFile)(test, 'utf8')

        return JSON.parse(content)
      } catch (e) {
        throw new Error(`Unable to read and parse the test file ${test}`)
      }
    })
  )
}

export const wait = async (duration: number) => new Promise((resolve) => setTimeout(resolve, duration))

export const waitForResults = async (
  api: APIHelper,
  triggerResponses: TriggerResponse[],
  defaultTimeout: number,
  triggerConfigs: TriggerConfig[]
) => {
  const triggerResultMap = createTriggerResultMap(triggerResponses, defaultTimeout, triggerConfigs)
  const triggerResults = [...triggerResultMap.values()]

  const maxPollingTimeout = Math.max(...triggerResults.map((tr) => tr.pollingTimeout))
  const pollingStartDate = new Date().getTime()
  while (triggerResults.filter((tr) => !tr.result).length) {
    const pollingDuration = new Date().getTime() - pollingStartDate

    // Remove test which exceeded their pollingTimeout
    for (const triggerResult of triggerResults.filter((tr) => !tr.result)) {
      if (pollingDuration >= triggerResult.pollingTimeout) {
        triggerResult.result = createTimeoutResult(
          triggerResult.result_id,
          triggerResult.device,
          triggerResult.location
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

const createTimeoutResult = (resultId: string, deviceId: string, dcId: number): PollResult => ({
  dc_id: dcId,
  result: {
    device: {id: deviceId},
    error: 'Timeout',
    eventType: 'finished',
    passed: false,
    stepDetails: [],
  },
  resultID: resultId,
})

export const runTests = async (
  api: APIHelper,
  triggerConfigs: TriggerConfig[],
  write: Writable['write']
): Promise<{tests: Test[]; triggers: Trigger}> => {
  const testsToTrigger: TestPayload[] = []

  const tests = await Promise.all(
    triggerConfigs.map(async ({config, id}) => {
      let test: Test | undefined
      id = PUBLIC_ID_REGEX.test(id) ? id : id.substr(id.lastIndexOf('/') + 1)
      try {
        test = await api.getTest(id)
      } catch (e) {
        const errorMessage = formatBackendErrors(e)
        write(`[${chalk.bold.dim(id)}] Test not found: ${errorMessage}\n`)
      }

      if (!test || config.executionRule === ExecutionRule.SKIPPED) {
        write(`[${chalk.bold.dim(id)}] Test skipped as per test or global configuration.\n`)

        return
      }

      if (test.options?.ci?.executionRule === ExecutionRule.SKIPPED) {
        write(`[${chalk.bold.dim(id)}] Test skipped as per execution rule in Datadog.\n`)

        return
      }

      write(renderTrigger(test, id, config))
      const overloadedConfig = handleConfig(test, id, write, config)
      write(renderWait(test))
      testsToTrigger.push(overloadedConfig)

      return test
    })
  )

  if (!testsToTrigger.length) {
    throw new Error('No tests to trigger')
  }

  const payload: Payload = {tests: testsToTrigger}
  const ciMetadata = getCIMetadata()
  if (ciMetadata) {
    payload.metadata = ciMetadata
  }

  try {
    return {
      tests: tests.filter(definedTypeGuard),
      triggers: await api.triggerTests(payload),
    }
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
