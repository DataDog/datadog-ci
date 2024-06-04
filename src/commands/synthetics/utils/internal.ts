import {
  BaseConfigOverride,
  BaseResult,
  ExecutionRule,
  MobileTestWithOverride,
  Result,
  ResultInBatch,
  ResultInBatchSkippedBySelectiveRerun,
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

type validTestOverridesValues = 'boolean' | 'number' | 'string' | 'string[]' | 'ExecutionRule'
type AccumulatorBaseConfigOverride = Omit<
  BaseConfigOverride,
  'basicAuth' | 'headers' | 'cookies' | 'deviceIds' | 'locations' | 'tunnel' | 'variables' | 'retry' // These options will be implemented later in separate PRs, see https://datadoghq.atlassian.net/browse/SYNTH-12971
> & {
  'retry.count'?: number
  'retry.interval'?: number
}
type AccumulatorBaseConfigOverrideKeys = keyof AccumulatorBaseConfigOverride
type OverridesValues = boolean | number | string | string[] | ExecutionRule

export const parseOverrideValue = (value: string, type: validTestOverridesValues): OverridesValues => {
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

  return overrides.reduce((acc: AccumulatorBaseConfigOverride, override: string) => {
    const [key, value] = override.split('=') as [AccumulatorBaseConfigOverrideKeys, string]

    // here, we want to parse the value according to its type. With sepcial case for retry
    switch (key) {
      // Convert to numbers
      case 'defaultStepTimeout':
      case 'pollingTimeout':
      case 'retry.count':
      case 'retry.interval':
      case 'testTimeout':
        acc[key] = parseOverrideValue(value, 'number') as number
        break

      // Convert to strings
      case 'body':
      case 'bodyType':
      case 'startUrl':
      case 'startUrlSubstitutionRegex':
        acc[key] = parseOverrideValue(value, 'string') as string
        break

      // Convert to boolean
      case 'allowInsecureCertificates':
      case 'followRedirects':
        acc[key] = parseOverrideValue(value, 'boolean') as boolean
        break

      // Convert to ExecutionRule
      case 'executionRule':
        acc[key] = parseOverrideValue(value, 'ExecutionRule') as ExecutionRule
        break

      // Special parsing for resourceUrlSubstitutionRegexes
      case 'resourceUrlSubstitutionRegexes':
        acc['resourceUrlSubstitutionRegexes'] = acc['resourceUrlSubstitutionRegexes'] ?? []
        acc['resourceUrlSubstitutionRegexes'].push(value)
        break

      // TODO: Convert to string[], to be implemented when adding localisations, variableStrings, etc.

      default:
        throw new Error(`Invalid key: ${key}`)
    }

    return acc
  }, {})
}
