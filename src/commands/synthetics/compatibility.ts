import {MainReporter, RunTestsCommandConfig, Suite, UserConfigOverride} from './interfaces'

export const moveLocationsToTestOverrides = (
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  warnDeprecatedLocations = false
): RunTestsCommandConfig => {
  const isLocationsUsedInRoot = (config.locations ?? []).length !== 0
  // At this point, `global` should already have been moved to `defaultTestOverrides`
  const isLocationsUsedInDefaultTestOverrides = (config.defaultTestOverrides?.locations ?? []).length !== 0

  if (isLocationsUsedInRoot && warnDeprecatedLocations) {
    reporter.error(
      "The 'locations' property should not be used at the root level of the global configuration file. Please put it in 'defaultTestOverrides' instead.\n If 'locations' exists in both places, only the one in 'defaultTestOverrides' is used!\n"
    )
  }

  // If the user hasn't migrated and is still using `locations` at the root level, move it in the `defaultTestOverrides`
  if (!isLocationsUsedInDefaultTestOverrides && isLocationsUsedInRoot) {
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

export const replaceConfigWithTestOverrides = (
  config: UserConfigOverride | undefined,
  testOverrides: UserConfigOverride | undefined
): UserConfigOverride => {
  const isConfigUsed = Object.keys(config ?? {}).length !== 0
  const isTestOverridesUsed = Object.keys(testOverrides ?? {}).length !== 0

  // If the user hasn't migrated and is still using `config` in test files, use `config`
  if (!isTestOverridesUsed && isConfigUsed) {
    return config ?? {}
  }

  return testOverrides ?? {}
}

export const replaceGlobalWithDefaultTestOverrides = (
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  warnDeprecatedGlobal = false
): RunTestsCommandConfig => {
  // The user is able to put both if they don't use the library in TS or use configuration files.
  const isGlobalUsed = Object.keys(config.global ?? {}).length !== 0
  const isDefaultTestOverridesUsed = Object.keys(config.defaultTestOverrides ?? {}).length !== 0
  if (isGlobalUsed && warnDeprecatedGlobal) {
    reporter.error(
      "The 'global' property is deprecated. Please use 'defaultTestOverrides' instead.\nIf both 'global' and 'defaultTestOverrides' properties exist, 'defaultTestOverrides' is used!\n"
    )
  }

  // If the user hasn't migrated and is still using `global`, use `global`
  if (!isDefaultTestOverridesUsed && isGlobalUsed) {
    return {
      ...config,
      defaultTestOverrides: {...config.global},
    }
  }

  return config
}

export const warnIfDeprecatedConfigUsed = (suites: Suite[], reporter: MainReporter): void => {
  // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
  const isUsingConfig = suites.some((suite) =>
    suite.content.tests.some((test) => Object.keys(test.config ?? {}).length > 0)
  )
  if (isUsingConfig) {
    reporter.error(
      "The 'config' property is deprecated. Please use 'testOverrides' instead.\nIf both 'config' and 'testOverrides' properties exist, 'testOverrides' is used!\n"
    )
  }
}
