import chalk from 'chalk'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {MainReporter, RunTestsCommandConfig, Suite, Test, TriggerConfig, UserConfigOverride} from './interfaces'
import {MAX_TESTS_TO_TRIGGER} from './run-tests-command'
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

  const testConfigs = suites
    .map((suite) =>
      suite.content.tests.map((test) => ({
        config: test.config,
        id: normalizePublicId(test.id) ?? '',
        suite: suite.name,
      }))
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testConfigs
}

export const getTestsFromSearchQuery = async (
  api: APIHelper,
  config: RunTestsCommandConfig,
  reporter: MainReporter
) => {
  const testsToTriggerBySearchQuery = await getTestListBySearchQuery(api, config.global, config.testSearchQuery || '')

  if (testsToTriggerBySearchQuery.length > MAX_TESTS_TO_TRIGGER) {
    reporter.error(
      `More than ${MAX_TESTS_TO_TRIGGER} tests returned by search query, only the first ${MAX_TESTS_TO_TRIGGER} will be fetched.\n`
    )
  }

  return testsToTriggerBySearchQuery
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

const getTestListBySearchQuery = async (
  api: APIHelper,
  globalConfigOverride: UserConfigOverride,
  testSearchQuery: string
) => {
  const testSearchResults = await api.searchTests(testSearchQuery)

  return testSearchResults.tests.map((test) => ({
    config: globalConfigOverride,
    id: test.public_id,
    suite: `Query: ${testSearchQuery}`,
  }))
}
