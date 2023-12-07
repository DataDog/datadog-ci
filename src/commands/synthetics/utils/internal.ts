import {ExecutionRule, Test, UserConfigOverride} from '../interfaces'

import {getStrictestExecutionRule} from './public'

export const getOverriddenExecutionRule = (
  test?: Test,
  configOverride?: UserConfigOverride
): ExecutionRule | undefined => {
  if (configOverride?.executionRule) {
    return getStrictestExecutionRule(configOverride.executionRule, test?.options?.ci?.executionRule)
  }
}
