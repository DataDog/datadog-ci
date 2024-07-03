import {MainReporter, RunTestsCommandConfig, Suite, UserConfigOverride} from './interfaces'

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

  // If both global and defaultTestOverrides exist, use defaultTestOverrides
  if (isGlobalUsed && !isDefaultTestOverridesUsed) {
    return {
      ...config,
      defaultTestOverrides: {...config.global},
    }
  }

  return config
}

export const replaceConfigWithTestOverrides = (
  config?: UserConfigOverride,
  testOverrides?: UserConfigOverride
): UserConfigOverride => {
  const isConfigUsed = Object.keys(config ?? {}).length !== 0
  const isTestOverridesUsed = Object.keys(testOverrides ?? {}).length !== 0

  // If both config and testOverrides exist, use testOverrides
  if (isConfigUsed && !isTestOverridesUsed) {
    return config ?? {}
  }

  return testOverrides ?? {}
}

export const warnIfDeprecatedConfigUsed = (suites: Suite[], reporter?: MainReporter): void => {
  // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
  const isUsingConfig = suites.some((suite) =>
    suite.content.tests.some((test) => Object.keys(test.config ?? {}).length > 0)
  )
  if (isUsingConfig) {
    reporter?.error(
      "The 'config' property is deprecated. Please use 'testOverrides' instead.\nIf both 'config' and 'testOverrides' properties exist, 'testOverrides' is used!\n"
    )
  }
}

export const moveLocationsToTestOverrides = (
  config: RunTestsCommandConfig,
  reporter?: MainReporter,
  warnDeprecatedLocations = false
): RunTestsCommandConfig => {
  const isLocationsUsedInRoot = (config.locations ?? []).length !== 0
  const isLocationsUsedInDefaultTestOverrides = (config.defaultTestOverrides?.locations ?? []).length !== 0

  if (isLocationsUsedInRoot && warnDeprecatedLocations) {
    reporter?.error(
      "The 'locations' property should not be used at the root level. Please use it to 'defaultTestOverrides' instead.\n If 'locations' is used in both places, only the one in 'defaultTestOverrides' is used!\n"
    )
  }

  // If locations exist in root and not in defaultTestOverrides, move them to defaultTestOverrides
  if (isLocationsUsedInRoot && !isLocationsUsedInDefaultTestOverrides) {
    return {
      ...config,
      defaultTestOverrides: {
        ...config.defaultTestOverrides,
        locations: config.locations,
      },
    }
  }

  return config
}
