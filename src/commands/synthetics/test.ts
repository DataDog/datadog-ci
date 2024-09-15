import chalk from 'chalk'

import {coerceError} from '../../helpers/errors'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {
  replaceConfigWithTestOverrides,
  warnIfDeprecatedConfigUsed,
  warnIfDeprecatedPollingTimeoutUsed,
} from './compatibility'
import {CriticalError} from './errors'
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

  suites.push(...(await getSuitesFromFiles(files, reporter)))

  warnIfDeprecatedConfigUsed(suites, reporter)
  warnIfDeprecatedPollingTimeoutUsed(suites, reporter)

  const testConfigs = suites
    .map((suite) =>
      suite.content.tests.map((test) => ({
        // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
        testOverrides: replaceConfigWithTestOverrides(test.config, test.testOverrides),
        id: normalizePublicId(test.id) ?? '',
        suite: suite.name,
      }))
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testConfigs
}

const getSuitesFromFiles = async (files: string[], reporter: MainReporter) => {
  try {
    const suitesFromFiles = (await Promise.all(files.map((glob: string) => getSuites(glob, reporter))))
      .reduce((acc, val) => acc.concat(val), [])
      .filter((suite) => !!suite.content.tests)

    return suitesFromFiles
  } catch (e) {
    throw new CriticalError('INVALID_CONFIG', coerceError(e))
  }
}

export const getTestsFromSearchQuery = async (
  api: APIHelper,
  config: Pick<RunTestsCommandConfig, 'defaultTestOverrides' | 'testSearchQuery'>
): Promise<TriggerConfig[] | []> => {
  const {defaultTestOverrides, testSearchQuery} = config

  // Empty search queries are not allowed.
  if (!testSearchQuery) {
    return []
  }

  try {
    const testSearchResults = await api.searchTests(testSearchQuery)

    return testSearchResults.tests.map((test) => ({
      testOverrides: defaultTestOverrides ?? {},
      id: test.public_id,
      suite: `Query: ${testSearchQuery}`,
    }))
  } catch (e) {
    throw new EndpointError(`Failed to search tests with query: ${formatBackendErrors(e)}`, e.response?.status)
  }
}

export const getTest = async (
  api: APIHelper,
  {id, suite}: TriggerConfig
): Promise<{test: Test} | {errorMessage: string}> => {
  try {
    const test = {
      ...(await api.getTest(id)),
      suite,
    }

    return {test}
  } catch (error) {
    if (isNotFoundError(error)) {
      const errorMessage = formatBackendErrors(error)

      return {errorMessage: `[${chalk.bold.dim(id)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}`}
    }

    throw new EndpointError(`Failed to get test: ${formatBackendErrors(error)}`, error.response?.status)
  }
}
