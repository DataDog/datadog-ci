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
  configOverride?: UserConfigOverride
): ExecutionRule | undefined => {
  if (configOverride?.executionRule) {
    return getStrictestExecutionRule(configOverride.executionRule, test?.options?.ci?.executionRule)
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
