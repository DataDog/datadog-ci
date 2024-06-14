import {
  BaseResult,
  BasicAuthCredentials,
  ExecutionRule,
  MobileTestWithOverride,
  Result,
  ResultInBatch,
  ResultInBatchSkippedBySelectiveRerun,
  RetryConfig,
  Test,
  TestNotFound,
  TestSkipped,
  TestWithOverride,
  UserConfigOverride,
} from '../interfaces'

import {getStrictestExecutionRule, isResultSkippedBySelectiveRerun} from './public'

export const getOverriddenExecutionRule = (
  test?: Test,
  testOverrides?: UserConfigOverride
): ExecutionRule | undefined => {
  if (testOverrides?.executionRule) {
    return getStrictestExecutionRule(testOverrides.executionRule, test?.options?.ci?.executionRule)
  }
}

export const hasResult = (result: Result): result is BaseResult => {
  return !isResultSkippedBySelectiveRerun(result)
}

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

export const toBoolean = (env: string | undefined): boolean | undefined => {
  if (env === undefined) {
    return undefined
  }

  if (env.toLowerCase() === 'true' || env === '1') {
    return true
  }

  if (env.toLowerCase() === 'false' || env === '0') {
    return false
  }

  return undefined
}

export const toNumber = (env: string | undefined): number | undefined => {
  if (env === undefined || env.trim() === '') {
    return undefined
  }

  const number = Number(env)

  if (isNaN(number)) {
    return undefined
  }

  return number
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

export const toStringObject = (env: string | undefined): {[key: string]: string} | undefined => {
  if (env === undefined) {
    return undefined
  }
  const cleanedEnv = env.replace(/'/g, '"').replace(/\s/g, '')

  try {
    const parsed = JSON.parse(cleanedEnv)
    // eslint-disable-next-line no-null/no-null
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key in parsed as object) {
        if (typeof parsed[key] !== 'string') {
          return undefined
        }
      }

      return parsed as {[key: string]: string}
    }
  } catch (error) {
    return undefined
  }
}

type AccumulatorBaseConfigOverride = Omit<
  UserConfigOverride,
  | 'retry'
  | 'basicAuth'
  | 'cookies'
  // TODO SYNTH-12971: These options will be implemented later in separate PRs
  | 'locations'
  | 'mobileApplicationVersion'
  | 'mobileApplicationVersionFilePath'
  | 'tunnel'
  | 'variables'
> & {
  retry?: Partial<RetryConfig>
  basicAuth?: Partial<BasicAuthCredentials>
  cookies?: Partial<Exclude<UserConfigOverride['cookies'], string>>
}
type AccumulatorBaseConfigOverrideKey = keyof AccumulatorBaseConfigOverride
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
      return value.trim()
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
      const match = override.match(/^(.*?)=(.*)$/) ?? [] // split key and value at first equal sign
      const rawKey = match[1] ?? ''
      const value = match[2] ?? ''

      const key = rawKey.split('.')[0] as AccumulatorBaseConfigOverrideKey
      const subKey = rawKey.split('.')[1]

      switch (key) {
        // Convert to number
        case 'defaultStepTimeout':
        case 'pollingTimeout':
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
          acc[key] = parseOverrideValue(value, 'string[]') as string[]
          break

        // Special parsing for resourceUrlSubstitutionRegexes
        case 'resourceUrlSubstitutionRegexes':
          acc['resourceUrlSubstitutionRegexes'] = acc['resourceUrlSubstitutionRegexes'] ?? []
          acc['resourceUrlSubstitutionRegexes'].push(value)
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

        // Convert to cookies (either a string or an object)
        case 'cookies':
          acc['cookies'] = acc['cookies'] ?? {}
          if (subKey) {
            if (subKey === 'append') {
              acc['cookies'].append = parseOverrideValue(value, 'boolean') as boolean
            } else {
              throw new Error(`The path "${key}.${subKey}" is invalid. Did you mean \`--override cookies=...\`?`)
            }
          } else {
            acc['cookies'].value = parseOverrideValue(value, 'string') as string
          }
          break

        // Convert to {[key: string]: string}
        case 'headers':
          if (subKey) {
            acc['headers'] = acc['headers'] ?? {}
            acc['headers'][subKey] = value
          } else {
            throw new Error(`No subkey found for ${key}`)
          }
          break

        default:
          throw new Error(`Invalid key: ${key}`)
      }

      return acc
    },
    {}
  )

  return parsedOverrides
}
