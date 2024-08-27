import chalk from 'chalk'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {
  replaceConfigWithTestOverrides,
  warnIfDeprecatedConfigUsed,
  warnIfDeprecatedPollingTimeoutUsed,
} from './compatibility'
import {MainReporter, RunTestsCommandConfig, Suite, Test, TriggerConfig} from './interfaces'
import {DEFAULT_TEST_CONFIG_FILES_GLOB} from './run-tests-command'
import {getSuites, normalizePublicId} from './utils/public'

export const getTestConfigs = async (
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  suites: Suite[] = []
): Promise<TriggerConfig[]> => {
  const files = [...config.files]

  // Only auto-discover with the default glob when the user **doesn't give any clue** about which tests to run.
  // If they give any clue (e.g. `publicIds`) without explicitly passing `files`,
  // they might be running the command from their home folder so we shouldn't auto-discover for performance reasons.
  if (config.publicIds.length === 0 && files.length === 0 && suites.length === 0 && !config.testSearchQuery) {
    files.push(DEFAULT_TEST_CONFIG_FILES_GLOB)
  }

  const suitesFromFiles = (await Promise.all(files.map((glob: string) => getSuites(glob, reporter))))
    .reduce((acc, val) => acc.concat(val), [])
    .filter((suite) => !!suite.content.tests)

  suites.push(...suitesFromFiles)

  warnIfDeprecatedConfigUsed(suites, reporter)
  warnIfDeprecatedPollingTimeoutUsed(suites, reporter)

  const testConfigs = suites
    .map((suite) =>
      suite.content.tests.map<TriggerConfig>((test) => ({
        // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
        testOverrides: replaceConfigWithTestOverrides(test.config, test.testOverrides),
        suite: suite.name,
        ...('id' in test
          ? {
              id: normalizePublicId(test.id) ?? '',
            }
          : {
              testDefinition: test.testDefinition,
            }),
      }))
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testConfigs
}

export const getTestsFromSearchQuery = async (
  api: APIHelper,
  config: Pick<RunTestsCommandConfig, 'defaultTestOverrides' | 'testSearchQuery'>
): Promise<TriggerConfig[]> => {
  const {defaultTestOverrides, testSearchQuery} = config

  // Empty search queries are not allowed.
  if (!testSearchQuery) {
    return []
  }

  const testSearchResults = await api.searchTests(testSearchQuery)

  return testSearchResults.tests.map((test) => ({
    testOverrides: defaultTestOverrides ?? {},
    id: test.public_id,
    suite: `Query: ${testSearchQuery}`,
  }))
}

export const getTest = async (
  api: APIHelper,
  publicId: string,
  suite?: string
): Promise<{test: Test} | {errorMessage: string}> => {
  try {
    const test = {
      ...(await api.getTest(publicId)),
      suite,
    }

    return {test}
  } catch (error) {
    if (isNotFoundError(error)) {
      const errorMessage = formatBackendErrors(error)

      return {errorMessage: `[${chalk.bold.dim(publicId)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}`}
    }

    throw new EndpointError(`Failed to get test: ${formatBackendErrors(error)}\n`, error.response?.status)
  }
}
