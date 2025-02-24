import {MainReporter, Suite, UserConfigOverride} from './interfaces'

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
