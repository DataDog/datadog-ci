import chalk from 'chalk'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {replaceConfigWithTestOverrides, warnIfDeprecatedConfigUsed} from './compatibility'
import {MainReporter, RunTestsCommandConfig, Suite, Test, TriggerConfig} from './interfaces'
import {getSuites, normalizePublicId} from './utils/public'

export const getTestConfigs = async (
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  suites: Suite[] = []
): Promise<TriggerConfig[]> => {
  const suitesFromFiles = (await Promise.all(config.files.map((glob: string) => getSuites(glob, reporter))))
    .reduce((acc, val) => acc.concat(val), [])
    .filter((suite) => !!suite.content.tests)

  suites.push(...suitesFromFiles)

  warnIfDeprecatedConfigUsed(suites, reporter)

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

export const getTestsFromSearchQuery = async (
  api: APIHelper,
  config: Pick<RunTestsCommandConfig, 'defaultTestOverrides' | 'testSearchQuery'>
): Promise<TriggerConfig[] | []> => {
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

    throw new EndpointError(`Failed to get test: ${formatBackendErrors(error)}\n`, error.response?.status)
  }
}
