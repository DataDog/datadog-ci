import {MainReporter, RunTestsCommandConfig} from './interfaces'

export const replaceGlobalWithDefaultTestOverrides = (
  config: RunTestsCommandConfig,
  reporter?: MainReporter,
  warnDeprecatedGlobal = false
): RunTestsCommandConfig => {
  // The user is able to put both if they don't use the library in TS or use configuration files.
  const isGlobalUsed = Object.keys(config.global ?? {}).length !== 0
  const isDefaultTestOverridesUsed = Object.keys(config.defaultTestOverrides ?? {}).length !== 0
  if (isGlobalUsed && warnDeprecatedGlobal) {
    reporter?.error(
      "The 'global' property is deprecated. Please use 'defaultTestOverrides' instead.\nIf both 'global' and 'defaultTestOverrides' properties exist, 'defaultTestOverrides' is used!\n"
    )
  }

  // If both global and defaultTestOverrides exist use defaultTestOverrides
  if (isGlobalUsed && !isDefaultTestOverridesUsed) {
    return {
      ...config,
      defaultTestOverrides: config.global,
    }
  }

  return config
}
