import {
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

  if ( env.toLowerCase() === 'true' || env === '1'){
    return true
  }

  if ( env.toLowerCase() === 'false' || env === '0'){
    return false
  }

  return undefined
}
