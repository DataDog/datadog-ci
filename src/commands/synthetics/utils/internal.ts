import {
  BaseResult,
  ExecutionRule,
  LegacyRunTestsCommandConfig,
  Result,
  ResultInBatch,
  ResultInBatchSkippedBySelectiveRerun,
  RunTestsCommandConfig,
  Test,
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

export const getResultIdOrLinkedResultId = (result: ResultInBatch): string => {
  if (isResultInBatchSkippedBySelectiveRerun(result)) {
    return result.selective_rerun.linked_result_id
  }

  return result.result_id
}

export const isLegacyRunTestsCommandConfig = (
  obj: LegacyRunTestsCommandConfig | RunTestsCommandConfig
): obj is LegacyRunTestsCommandConfig => {
  return 'global' in obj
}
