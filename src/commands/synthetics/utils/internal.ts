import {toBoolean, toNumber, StringMap} from '../../../helpers/env'
import {pick} from '../../../helpers/utils'

import {
  BaseResult,
  BasicAuthCredentials,
  BrowserServerResult,
  CookiesObject,
  ExecutionRule,
  LocalTriggerConfig,
  MobileTestWithOverride,
  Result,
  ResultInBatch,
  ResultInBatchSkippedBySelectiveRerun,
  RetryConfig,
  ServerConfigOverride,
  ServerResult,
  Test,
  TestNotFound,
  TestPayload,
  TestSkipped,
  TestWithOverride,
  TriggerConfig,
  UserConfigOverride,
} from '../interfaces'

import {getStrictestExecutionRule, isResultSkippedBySelectiveRerun} from './public'

const levenshtein = require('fast-levenshtein')

export const wait = async (duration: number) => new Promise((resolve) => setTimeout(resolve, duration))

export const getOverriddenExecutionRule = (
  test?: Test,
  testOverrides?: UserConfigOverride
): ExecutionRule | undefined => {
  if (testOverrides?.executionRule) {
    return getStrictestExecutionRule(testOverrides.executionRule, test?.options?.ci?.executionRule)
  }
}

export const hasResultPassed = (
  result: ResultInBatch,
  isUnhealthy: boolean,
  hasTimedOut: boolean,
  options: {
    failOnCriticalErrors?: boolean
    failOnTimeout?: boolean
  }
): boolean => {
  if (isUnhealthy && !options.failOnCriticalErrors) {
    return true
  }

  if (hasTimedOut && !options.failOnTimeout) {
    return true
  }

  return result.status === 'passed'
}

/**
 * Whether the result is of type {@link BaseResult}, i.e. it wasn't skipped.
 */
export const isBaseResult = (result: Result): result is BaseResult => {
  return !isResultSkippedBySelectiveRerun(result)
}

/**
 * Whether the result has a defined {@link BaseResult.result} property.
 *
 * This property would be undefined if the server result isn't available when polling for it,
 * which is a known latency issue. We call such result an incomplete result.
 */
export const hasDefinedResult = (result: Result): result is BaseResult & {result: ServerResult} => {
  return isBaseResult(result) && result.result !== undefined
}

/**
 * When the test is configured to be retried and the first attempt fails, `retries` is set to `0`
 * and the result is kept `in_progress` until the final result is received.
 */
export const isNonFinalResult = (
  result: ResultInBatch
): result is ResultInBatch & {retries: number; status: 'in_progress'} => {
  return result.status === 'in_progress' && Number.isInteger(result.retries)
}

export const isTimedOutRetry = (
  retries: number | null,
  maxRetries: number | null,
  timedOut: boolean | null
): boolean => {
  return !!timedOut && (retries ?? 0) < (maxRetries ?? 0)
}

export const isLocalTriggerConfig = (triggerConfig?: TriggerConfig): triggerConfig is LocalTriggerConfig => {
  return triggerConfig ? 'localTestDefinition' in triggerConfig : false
}

export const isBrowserServerResult = (serverResult: ServerResult): serverResult is BrowserServerResult => {
  return (serverResult as BrowserServerResult).steps !== undefined
}

export const getTriggerConfigPublicId = (triggerConfig: TriggerConfig): string | undefined => {
  if (isLocalTriggerConfig(triggerConfig)) {
    return triggerConfig.localTestDefinition.public_id
  }

  return triggerConfig.id
}

export const LOCAL_TEST_DEFINITION_PUBLIC_ID_PLACEHOLDER = 'local'

export const getPublicIdOrPlaceholder = (test: Test | TestPayload | {public_id?: string}): string =>
  ('public_id' in test && test.public_id) || LOCAL_TEST_DEFINITION_PUBLIC_ID_PLACEHOLDER

export const isResultInBatchSkippedBySelectiveRerun = (
  result: ResultInBatch
): result is ResultInBatchSkippedBySelectiveRerun => {
  return result.selective_rerun?.decision === 'skip'
}

export const isMobileTestWithOverride = (
  item: TestNotFound | TestSkipped | TestWithOverride
): item is MobileTestWithOverride =>
  'test' in item && item.test.type === 'mobile' && !!item.test.options && !!item.test.options.mobileApplication

export const getResultIdOrLinkedResultId = (result: ResultInBatch): string => {
  if (isResultInBatchSkippedBySelectiveRerun(result)) {
    return result.selective_rerun.linked_result_id
  }

  return result.result_id
}

export const toExecutionRule = (env: string | undefined): ExecutionRule | undefined => {
  if (env === undefined) {
    return undefined
  }
  const enumValues = Object.values(ExecutionRule)
  if (enumValues.includes(env.toLowerCase() as ExecutionRule)) {
    return env.toLowerCase() as ExecutionRule
  }

  return undefined
}

type AccumulatorBaseConfigOverride = Omit<
  UserConfigOverride,
  // Objects that are changed to partial.
  | 'retry'
  | 'basicAuth'
  | 'cookies'
  | 'setCookies'
  // TODO SYNTH-19776: These options will be implemented later.
  | 'mobileApplicationVersion'
  | 'mobileApplicationVersionFilePath'
> & {
  retry?: Partial<RetryConfig>
  basicAuth?: Partial<BasicAuthCredentials>
  cookies?: Partial<CookiesObject>
  setCookies?: Partial<CookiesObject>
}
type AccumulatorBaseConfigOverrideKey = keyof AccumulatorBaseConfigOverride
const allOverrideKeys: AccumulatorBaseConfigOverrideKey[] = [
  'cookies',
  'setCookies',
  'retry',
  'basicAuth',
  'allowInsecureCertificates',
  'body',
  'bodyType',
  'defaultStepTimeout',
  'deviceIds',
  'executionRule',
  'followRedirects',
  'headers',
  'locations',
  'resourceUrlSubstitutionRegexes',
  'startUrl',
  'startUrlSubstitutionRegex',
  'testTimeout',
  'variables',
]
type TestOverrideValueType = boolean | number | string | string[] | ExecutionRule
type ValidTestOverrideValueTypeName = 'boolean' | 'number' | 'string' | 'string[]' | 'ExecutionRule'

export const parseOverrideValue = (value: string, type: ValidTestOverrideValueTypeName): TestOverrideValueType => {
  switch (type) {
    case 'boolean':
      const parsedBoolean = toBoolean(value)
      if (parsedBoolean !== undefined) {
        return parsedBoolean
      }
      throw new Error(`Invalid boolean value: ${value}`)
    case 'number':
      const parsedNumber = toNumber(value)
      if (parsedNumber !== undefined) {
        return parsedNumber
      }
      throw new Error(`Invalid number value: ${value}`)
    case 'string':
      return value.replace(/\\n/g, '\n').trim()
    case 'string[]':
      return value.split(';').map((item) => item.trim())
    case 'ExecutionRule':
      const parsedExecutionRule = toExecutionRule(value)
      if (parsedExecutionRule !== undefined) {
        return parsedExecutionRule
      }
      throw new Error(`Invalid ExecutionRule value: ${value}`)
    default:
      throw new Error(`Unknown type: ${type}`)
  }
}

export const validateAndParseOverrides = (overrides: string[] | undefined): AccumulatorBaseConfigOverride => {
  if (!overrides) {
    return {}
  }
  const parsedOverrides: AccumulatorBaseConfigOverride = overrides.reduce(
    (acc: AccumulatorBaseConfigOverride, override: string) => {
      const match = override.match(/^(.*?)=(.*)$/s) ?? [] // split key and value at first equal sign
      const rawKey = match[1] ?? ''
      const value = match[2] ?? ''

      const key = rawKey.split('.')[0] as AccumulatorBaseConfigOverrideKey
      const subKey = rawKey.split('.')[1]

      switch (key) {
        // Convert to number
        case 'defaultStepTimeout':
        case 'testTimeout':
          acc[key] = parseOverrideValue(value, 'number') as number
          break

        // Convert to boolean
        case 'allowInsecureCertificates':
        case 'followRedirects':
          acc[key] = parseOverrideValue(value, 'boolean') as boolean
          break

        // Convert to string
        case 'body':
        case 'bodyType':
        case 'startUrl':
        case 'startUrlSubstitutionRegex':
          acc[key] = parseOverrideValue(value, 'string') as string
          break

        // Convert to string[]
        case 'deviceIds':
        case 'locations':
        case 'resourceUrlSubstitutionRegexes':
          acc[key] = parseOverrideValue(value, 'string[]') as string[]
          break

        // Convert to ExecutionRule
        case 'executionRule':
          acc[key] = parseOverrideValue(value, 'ExecutionRule') as ExecutionRule
          break

        // Convert to RetryConfig
        case 'retry':
          switch (subKey as keyof RetryConfig) {
            case 'count':
            case 'interval':
              acc['retry'] = acc['retry'] ?? {}
              acc['retry'][subKey as keyof RetryConfig] = parseOverrideValue(value, 'number') as number
              break
            default:
              throw new Error(`Invalid subkey for ${key}`)
          }
          break

        // Convert to BasicAuthCredentials
        case 'basicAuth':
          switch (subKey as keyof BasicAuthCredentials) {
            case 'username':
            case 'password':
              acc['basicAuth'] = acc['basicAuth'] ?? {}
              acc['basicAuth'][subKey as keyof BasicAuthCredentials] = parseOverrideValue(value, 'string') as string
              break
            default:
              throw new Error(`Invalid subkey for ${key}`)
          }
          break

        // Convert to cookies and set-cookies (either a string or an object)
        case 'cookies':
        case 'setCookies':
          acc[key] = acc[key] ?? {}
          if (subKey) {
            if (subKey === 'append') {
              ;(acc[key] as CookiesObject).append = parseOverrideValue(value, 'boolean') as boolean
            } else {
              throw new Error(`The path "${key}.${subKey}" is invalid. Did you mean \`--override ${key}=...\`?`)
            }
          } else {
            ;(acc[key] as CookiesObject).value = parseOverrideValue(value, 'string') as string
          }
          break

        // Convert to StringMap
        case 'headers':
        case 'variables':
          if (subKey) {
            acc[key] = acc[key] ?? {}
            ;(acc[key] as StringMap)[subKey] = value
          } else {
            throw new Error(`No subkey found for ${key}`)
          }
          break

        default:
          const closestKey = allOverrideKeys.reduce((prev, curr) =>
            levenshtein.get(curr, key) < levenshtein.get(prev, key) ? curr : prev
          )

          if (levenshtein.get(closestKey, key) > 5) {
            throw new Error(`Invalid key: ${key}`)
          }

          throw new Error(`Invalid key: ${key}. Did you mean \`${closestKey}\`?`)
      }

      return acc
    },
    {}
  )

  return parsedOverrides
}

const TEMPLATE_REGEX = /{{\s*([^{}]*?)\s*}}/g

const template = (st: string, context: any): string =>
  st.replace(TEMPLATE_REGEX, (match: string, p1: string) => (p1 in context ? context[p1] : match))

export const getBasePayload = (test: Test, testOverrides?: UserConfigOverride): ServerConfigOverride => {
  let overriddenConfig: ServerConfigOverride = {}

  if (!testOverrides || !Object.keys(testOverrides).length) {
    return overriddenConfig
  }

  const executionRule = getOverriddenExecutionRule(test, testOverrides)
  if (executionRule) {
    overriddenConfig.executionRule = executionRule
  }

  overriddenConfig = {
    ...overriddenConfig,
    ...pick(testOverrides, [
      'allowInsecureCertificates',
      'basicAuth',
      'body',
      'bodyType',
      'cookies',
      'setCookies',
      'defaultStepTimeout',
      'deviceIds',
      'followRedirects',
      'headers',
      'locations',
      'resourceUrlSubstitutionRegexes',
      'retry',
      'startUrlSubstitutionRegex',
      'testTimeout',
      'variables',
    ]),
  }

  if ((test.type === 'browser' || test.subtype === 'http') && testOverrides.startUrl) {
    overriddenConfig.startUrl = template(testOverrides.startUrl, {...process.env})
  }

  return overriddenConfig
}
