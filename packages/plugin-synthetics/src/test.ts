import type {APIHelper} from './api'
import type {
  RemoteTriggerConfig,
  MainReporter,
  RunTestsCommandConfig,
  Suite,
  Test,
  TriggerConfig,
  LocalTestDefinition,
  ImportTestsCommandConfig,
  TestMissing,
  TestSkipped,
  TestWithOverride,
  TestPlanItem,
  DeployTestsCommandConfig,
} from './interfaces'
import type {InitialSummary} from './utils/public'

import chalk from 'chalk'

import {EndpointError, formatBackendErrors, isNotFoundError, isForbiddenError} from './api'
import {CiError, CriticalError} from './errors'
import {ExecutionRule} from './interfaces'
import {uploadMobileApplicationsAndUpdateOverrideConfigs} from './mobile'
import {
  getPublicIdOrPlaceholder,
  getTriggerConfigPublicId,
  isLocalTriggerConfig,
  isMobileTestWithOverride,
} from './utils/internal'
import {
  createInitialSummary,
  getSuites,
  isTestSupportedByTunnel,
  makeTestPayload,
  normalizePublicId,
} from './utils/public'

export const MAX_TESTS_TO_TRIGGER = 1000

export const DEFAULT_TEST_CONFIG_FILES_GLOB = '{,!(node_modules)/**/}*.synthetics.json'

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
      suite.content.tests.map<TriggerConfig>((test) => {
        const suiteFileName = suite.name

        return {
          testOverrides: test.testOverrides,
          suite: suiteFileName,
          ...(isLocalTriggerConfig(test)
            ? {localTestDefinition: normalizeLocalTestDefinition(test.localTestDefinition)}
            : {
                id: normalizePublicId(test.id) ?? '',
                version: test.version,
              }),
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

  return testSearchResults.tests.map((test: {public_id: string}) => ({
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

  const testPlan: TestPlanItem[] = []
  testsAndConfigsOverride.forEach((item) => {
    if ('errorMessage' in item) {
      errorMessages.push(item.errorMessage)
    } else {
      testPlan.push({test: item.test, testOverrides: item.overriddenConfig, executionRule: item.executionRule})
    }
  })

  // Display errors at the end of all tests for better visibility.
  reporter.initErrors(errorMessages)

  if (failOnMissingTests && initialSummary.testsNotFound.size > 0) {
    const testsNotFoundListStr = chalk.gray([...initialSummary.testsNotFound].join(', '))
    throw new CiError('MISSING_TESTS', testsNotFoundListStr)
  }

  if (failOnMissingTests && initialSummary.testsNotAuthorized.size > 0) {
    const testsNotAuthorizedListStr = chalk.gray([...initialSummary.testsNotAuthorized].join(', '))
    throw new CiError('UNAUTHORIZED_TESTS', testsNotAuthorizedListStr)
  }

  if (!testPlan.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  } else if (testPlan.length > MAX_TESTS_TO_TRIGGER) {
    throw new CriticalError(
      'TOO_MANY_TESTS_TO_TRIGGER',
      `Cannot trigger more than ${MAX_TESTS_TO_TRIGGER} tests (received ${triggerConfigs.length})`
    )
  }

  return {testPlan, initialSummary}
}

export const getTestAndOverrideConfig = async (
  api: APIHelper,
  triggerConfig: TriggerConfig,
  reporter: MainReporter,
  summary: InitialSummary,
  isTunnelEnabled?: boolean
): Promise<TestMissing | TestSkipped | TestWithOverride> => {
  const publicIdOrPlaceholder = getPublicIdOrPlaceholder({public_id: getTriggerConfigPublicId(triggerConfig)})
  const normalizedId = normalizePublicId(publicIdOrPlaceholder)
  if (!normalizedId) {
    throw new CriticalError('INVALID_CONFIG', `No valid public ID found in: \`${publicIdOrPlaceholder}\``)
  }

  const testResult = await getTest(api, triggerConfig)
  if ('errorMessage' in testResult) {
    if (
      testResult.errorMessage.includes('Test not found') ||
      testResult.errorMessage.includes('Test version not found')
    ) {
      summary.testsNotFound.add(normalizedId)
    } else if (testResult.errorMessage.includes('Test not authorized')) {
      summary.testsNotAuthorized.add(normalizedId)
    }

    return {errorMessage: testResult.errorMessage}
  }

  const {test} = testResult
  const overriddenConfig = makeTestPayload(test, triggerConfig, normalizedId)
  const testExecutionRule = test?.options?.ci?.executionRule
  const executionRule = overriddenConfig.executionRule || testExecutionRule || ExecutionRule.BLOCKING

  reporter.testTrigger(test, normalizedId, executionRule, triggerConfig.testOverrides ?? {})
  if (executionRule === ExecutionRule.SKIPPED) {
    summary.skipped++

    return {test, overriddenConfig, executionRule: ExecutionRule.SKIPPED}
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

  return {test, overriddenConfig, executionRule}
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

  const {id: publicId, suite: suiteFileName, version} = triggerConfig

  if (version !== undefined) {
    try {
      await api.getTestVersion(publicId, version)
    } catch (error) {
      if (isForbiddenError(error)) {
        const errorMessage = formatBackendErrors(error)

        return {errorMessage: `[${chalk.bold.dim(publicId)}] ${chalk.red.bold('Test not authorized')}: ${errorMessage}`}
      }

      if (isNotFoundError(error)) {
        const errorMessage = formatBackendErrors(error)

        return {
          errorMessage: `[${chalk.bold.dim(publicId)}@${version}] ${chalk.yellow.bold(
            'Test version not found'
          )}: ${errorMessage}`,
        }
      }
    }
  }

  try {
    const test = {
      ...(await api.getTest(publicId)),
      suite: suiteFileName,
    }

    return {test}
  } catch (error) {
    if (isNotFoundError(error)) {
      // The public ID might refer to a test suite rather than a test. In that case, the `/trigger/ci` endpoint fans out the suite into its member tests in the CI batch.
      const suiteAsTest = await getSuiteAsTest(api, publicId, suiteFileName)
      if (suiteAsTest) {
        return {test: suiteAsTest}
      }

      const errorMessage = formatBackendErrors(error)

      return {errorMessage: `[${chalk.bold.dim(publicId)}] ${chalk.yellow.bold('Test not found')}: ${errorMessage}`}
    }

    if (isForbiddenError(error)) {
      const errorMessage = formatBackendErrors(error)

      return {errorMessage: `[${chalk.bold.dim(publicId)}] ${chalk.red.bold('Test not authorized')}: ${errorMessage}`}
    }

    throw new EndpointError(`Failed to get test: ${formatBackendErrors(error)}\n`, error.response?.status)
  }
}

const getSuiteAsTest = async (api: APIHelper, publicId: string, suite?: string): Promise<Test | undefined> => {
  try {
    const {data} = await api.getSyntheticsSuite(publicId)

    // Placeholder test representing the test suite. Its members' own name/type/etc. aren't fetched
    // here: the batch results for them already carry that information directly (`test_name`, `test_type`).
    return {
      config: {assertions: [], variables: []},
      locations: [],
      name: data.attributes.name,
      options: {},
      public_id: data.id,
      type: 'suite',
      memberPublicIds: data.attributes.tests.map((t) => t.public_id),
      suite,
    }
  } catch (error) {
    // In most cases, the publicId won't refer to a suite, so we return undefined to favor the "Test not found" error.
    return undefined
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
