import chalk from 'chalk'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {
  replaceConfigWithTestOverrides,
  warnIfDeprecatedConfigUsed,
  warnIfDeprecatedPollingTimeoutUsed,
} from './compatibility'
import {
  RemoteTriggerConfig,
  MainReporter,
  RunTestsCommandConfig,
  Suite,
  Test,
  TriggerConfig,
  LocalTestDefinition,
  ImportTestsCommandConfig,
} from './interfaces'
import {DEFAULT_TEST_CONFIG_FILES_GLOB} from './run-tests-command'
import {isLocalTriggerConfig} from './utils/internal'
import {getSuites, normalizePublicId} from './utils/public'

export const getTestConfigs = async (
  config: RunTestsCommandConfig | ImportTestsCommandConfig,
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
      suite.content.tests.map((test) => {
        return {
          // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
          testOverrides: replaceConfigWithTestOverrides(test.config, test.testOverrides),
          suite: suite.name,
          ...(isLocalTriggerConfig(test)
            ? {local_test_definition: normalizeLocalTestDefinition(test.local_test_definition)}
            : {id: normalizePublicId(test.id) ?? ''}),
        }
      })
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testConfigs
}

export const getTestsFromSearchQuery = async (
  api: APIHelper,
  config: Pick<RunTestsCommandConfig, 'defaultTestOverrides' | 'testSearchQuery'>
): Promise<RemoteTriggerConfig[] | []> => {
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
  triggerConfig: TriggerConfig
): Promise<{test: Test} | {errorMessage: string}> => {
  if (isLocalTriggerConfig(triggerConfig)) {
    const test = {
      ...triggerConfig.local_test_definition,
      suite: triggerConfig.suite,
    }

    return {test}
  }

  const {id: publicId, suite} = triggerConfig

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

export const normalizeLocalTestDefinition = (localTestDefinition: LocalTestDefinition) => {
  // Support links here too for QoL and consistency with `RemoteTriggerConfig.id`
  const publicId = localTestDefinition.public_id && normalizePublicId(localTestDefinition.public_id)

  return {
    ...localTestDefinition,
    public_id: publicId,
  }
}
