import {
  BaseResult,
  ExecutionRule,
  LegacyRunTestsCommandConfig,
  MainReporter,
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

export const isLegacyRunTestCommandConfig = (
  config: LegacyRunTestsCommandConfig | RunTestsCommandConfig,
  reporter?: MainReporter
): config is LegacyRunTestsCommandConfig => {
  // The user is able to put both if they don't use the library in TS or use configuration files.
  const compatibilityConfig = config as LegacyRunTestsCommandConfig & RunTestsCommandConfig

  const isGlobalUsed = Object.keys(compatibilityConfig.global ?? {}).length !== 0
  const isDefaultTestOverridesUsed = Object.keys(compatibilityConfig.defaultTestOverrides ?? {}).length !== 0
  if (isGlobalUsed) {
    reporter?.error(
      "The 'global' property is deprecated. Please use 'defaultTestOverrides' instead.\nIf both 'global' and 'defaultTestOverrides' properties exist, 'defaultTestOverrides' is used!"
    )
  }

  return isGlobalUsed && !isDefaultTestOverridesUsed
}
