import chalk from 'chalk'

import {APIHelper, EndpointError, formatBackendErrors, isNotFoundError} from './api'
import {CiError, CriticalError} from './errors'
import {
  RemoteTriggerConfig,
  MainReporter,
  RunTestsCommandConfig,
  Suite,
  Test,
  TriggerConfig,
  LocalTestDefinition,
  ImportTestsCommandConfig,
  ExecutionRule,
  TestNotFound,
  TestSkipped,
  TestWithOverride,
  TestPayload,
  DeployTestsCommandConfig,
} from './interfaces'
import {uploadMobileApplicationsAndUpdateOverrideConfigs} from './mobile'
import {DEFAULT_TEST_CONFIG_FILES_GLOB, MAX_TESTS_TO_TRIGGER} from './run-tests-command'
import {
  getPublicIdOrPlaceholder,
  getTriggerConfigPublicId,
  isLocalTriggerConfig,
  isMobileTestWithOverride,
} from './utils/internal'
import {
  InitialSummary,
  createInitialSummary,
  getSuites,
  isTestSupportedByTunnel,
  makeTestPayload,
  normalizePublicId,
} from './utils/public'

export const getTestConfigs = async (
  config: RunTestsCommandConfig | ImportTestsCommandConfig | DeployTestsCommandConfig,
  reporter: MainReporter,
  suites: Suite[] = []
): Promise<TriggerConfig[]> => {
  const files = [...config.files]

  // Only auto-discover with the default glob when the user **doesn't give any clue** about which tests to run.
  // If they give any clue (e.g. `publicIds`) without explicitly passing `files`,
  // they might be running the command from their home folder so we shouldn't auto-discover for performance reasons.
  if (
    config.publicIds.length === 0 &&
    files.length === 0 &&
    suites.length === 0 &&
    'testSearchQuery' in config &&
    !config.testSearchQuery
  ) {
    files.push(DEFAULT_TEST_CONFIG_FILES_GLOB)
  }

  const suitesFromFiles = (await Promise.all(files.map((glob: string) => getSuites(glob, reporter))))
    .reduce((acc, val) => acc.concat(val), [])
    .filter((suite) => !!suite.content.tests)

  suites.push(...suitesFromFiles)

  const testConfigs = suites
    .map((suite) =>
      suite.content.tests.map((test) => {
        return {
          testOverrides: test.testOverrides,
          suite: suite.name,
          ...(isLocalTriggerConfig(test)
            ? {localTestDefinition: normalizeLocalTestDefinition(test.localTestDefinition)}
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

export const getTestsToTrigger = async (
  api: APIHelper,
  triggerConfigs: TriggerConfig[],
  reporter: MainReporter,
  triggerFromSearch?: boolean,
  failOnMissingTests?: boolean,
  isTunnelEnabled?: boolean
) => {
  const errorMessages: string[] = []

  // When too many tests are triggered, if fetched from a search query: simply trim them and show a warning,
  // otherwise: retrieve them and fail later if still exceeding without skipped/missing tests.
  if (triggerFromSearch && triggerConfigs.length > MAX_TESTS_TO_TRIGGER) {
    const testsCount = triggerConfigs.length
    triggerConfigs.splice(MAX_TESTS_TO_TRIGGER)
    const maxTests = chalk.bold(MAX_TESTS_TO_TRIGGER)
    errorMessages.push(
      chalk.yellow(`The search query returned ${testsCount} tests, only the first ${maxTests} will be triggered.\n`)
    )
  }

  const initialSummary = createInitialSummary()
  const testsAndConfigsOverride = await Promise.all(
    triggerConfigs.map((triggerConfig) =>
      getTestAndOverrideConfig(api, triggerConfig, reporter, initialSummary, isTunnelEnabled)
    )
  )

  await uploadMobileApplicationsAndUpdateOverrideConfigs(
    api,
    triggerConfigs,
    testsAndConfigsOverride.filter(isMobileTestWithOverride)
  )

  const overriddenTestsToTrigger: TestPayload[] = []
  const waitedTests: Test[] = []
  testsAndConfigsOverride.forEach((item) => {
    if ('errorMessage' in item) {
      errorMessages.push(item.errorMessage)
    }

    if ('overriddenConfig' in item) {
      overriddenTestsToTrigger.push(item.overriddenConfig)
    }

    if ('test' in item) {
      waitedTests.push(item.test)
    }
  })

  // Display errors at the end of all tests for better visibility.
  reporter.initErrors(errorMessages)

  if (failOnMissingTests && initialSummary.testsNotFound.size > 0) {
    const testsNotFoundListStr = [...initialSummary.testsNotFound].join(', ')
    throw new CiError('MISSING_TESTS', testsNotFoundListStr)
  }

  if (!overriddenTestsToTrigger.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  } else if (overriddenTestsToTrigger.length > MAX_TESTS_TO_TRIGGER) {
    throw new CriticalError(
      'TOO_MANY_TESTS_TO_TRIGGER',
      `Cannot trigger more than ${MAX_TESTS_TO_TRIGGER} tests (received ${triggerConfigs.length})`
    )
  }

  return {tests: waitedTests, overriddenTestsToTrigger, initialSummary}
}

export const getTestAndOverrideConfig = async (
  api: APIHelper,
  triggerConfig: TriggerConfig,
  reporter: MainReporter,
  summary: InitialSummary,
  isTunnelEnabled?: boolean
): Promise<TestNotFound | TestSkipped | TestWithOverride> => {
  const publicIdOrPlaceholder = getPublicIdOrPlaceholder({public_id: getTriggerConfigPublicId(triggerConfig)})
  const normalizedId = normalizePublicId(publicIdOrPlaceholder)
  if (!normalizedId) {
    throw new CriticalError('INVALID_CONFIG', `No valid public ID found in: \`${publicIdOrPlaceholder}\``)
  }

  const testResult = await getTest(api, triggerConfig)
  if ('errorMessage' in testResult) {
    summary.testsNotFound.add(normalizedId)

    return {errorMessage: testResult.errorMessage}
  }

  const {test} = testResult
  const overriddenConfig = makeTestPayload(test, triggerConfig, normalizedId)
  const testExecutionRule = test?.options?.ci?.executionRule
  const executionRule = overriddenConfig.executionRule || testExecutionRule || ExecutionRule.BLOCKING

  reporter.testTrigger(test, normalizedId, executionRule, triggerConfig.testOverrides ?? {})
  if (executionRule === ExecutionRule.SKIPPED) {
    summary.skipped++

    return {overriddenConfig}
  }
  reporter.testWait(test)

  if (isTunnelEnabled && !isTestSupportedByTunnel(test)) {
    const details = [`public ID: ${normalizedId}`, `type: ${test.type}`]

    if (test.subtype) {
      details.push(`sub-type: ${test.subtype}`)
    }

    if (test.subtype === 'multi') {
      const unsupportedStepSubTypes = (test.config.steps || [])
        .filter((step) => step.subtype !== 'http')
        .map(({subtype}) => subtype)

      details.push(`step sub-types: [${unsupportedStepSubTypes.join(', ')}]`)
    }

    throw new CriticalError(
      'TUNNEL_NOT_SUPPORTED',
      `The tunnel is only supported with HTTP API tests and Browser tests (${details.join(', ')}).`
    )
  }

  return {test, overriddenConfig}
}

const getTest = async (
  api: APIHelper,
  triggerConfig: TriggerConfig
): Promise<{test: Test} | {errorMessage: string}> => {
  if (isLocalTriggerConfig(triggerConfig)) {
    const test = {
      ...triggerConfig.localTestDefinition,
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
