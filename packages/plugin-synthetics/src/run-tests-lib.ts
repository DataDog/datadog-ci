import type {APIHelper} from './api'
import type {
  MainReporter,
  Reporter,
  Result,
  RunTestsCommandConfig,
  Suite,
  Summary,
  SupportedReporter,
  Test,
  TestPayload,
  TestPlan,
  TriggerConfig,
  TriggerInfo,
  WrapperConfig,
} from './interfaces'
import type {InitialSummary} from './utils/public'

import {getCIMetadata} from '@datadog/datadog-ci-base/helpers/ci'
import {GIT_COMMIT_MESSAGE} from '@datadog/datadog-ci-base/helpers/tags'

import {getApiHelper, isForbiddenError} from './api'
import {DEFAULT_BATCH_TIMEOUT, runTests, waitForResults} from './batch'
import {CiError, CriticalError, BatchTimeoutRunawayError} from './errors'
import {ExecutionRule} from './interfaces'
import {getTunnelProxyAgent} from './proxy'
import {updateLTDMultiLocators} from './multilocator'
import {DefaultReporter, getTunnelReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {getTestConfigs, getTestsFromSearchQuery, getTestsToTrigger} from './test'
import {Tunnel} from './tunnel'
import {
  getDefaultConfig as getDefaultConfigBase,
  getTriggerConfigPublicId,
  isLocalTestPayload,
  isLocalTriggerConfig,
} from './utils/internal'
import {
  getReporter,
  getOrgSettings,
  createInitialSummary,
  parsePublicIdWithVersion,
  renderResults,
  getExitReason,
  toExitCode,
  reportExitLogs,
} from './utils/public'

type ExecuteOptions = {
  initialSummary?: InitialSummary
  jUnitReport?: string
  reporters?: (SupportedReporter | Reporter)[]
  runId?: string
  suites?: Suite[]
  testPlan?: TestPlan
}

export const getDefaultConfig = (): RunTestsCommandConfig => {
  return {
    ...getDefaultConfigBase(),
    batchTimeout: DEFAULT_BATCH_TIMEOUT,
    defaultTestOverrides: {},
    failOnCriticalErrors: false,
    failOnMissingTests: false,
    failOnTimeout: true,
    files: [],
    jUnitReport: '',
    publicIds: [],
    subdomain: 'app',
    testSearchQuery: '',
    tunnel: false,
  }
}

export const executeTests = async (
  reporter: MainReporter,
  config: RunTestsCommandConfig,
  suites?: Suite[],
  testPlan?: TestPlan,
  providedInitialSummary?: InitialSummary
): Promise<{
  results: Result[]
  summary: Summary
}> => {
  const api = getApiHelper(config)
  let tunnel: Tunnel | undefined

  const stopTunnel = async () => {
    if (tunnel) {
      await tunnel.stop()
    }
  }

  let hasLTD: boolean
  let tests: Test[]
  let overriddenTestsToTrigger: TestPayload[]
  let initialSummary: InitialSummary

  if (testPlan) {
    overriddenTestsToTrigger = testPlan.map((item) => item.testOverrides)
    tests = testPlan.filter((item) => item.executionRule !== ExecutionRule.SKIPPED).map((item) => item.test)
    initialSummary = providedInitialSummary ?? createInitialSummary()
    hasLTD = overriddenTestsToTrigger.some(isLocalTestPayload)
  } else {
    let triggerConfigs: TriggerConfig[] = []

    try {
      triggerConfigs = await getTriggerConfigs(api, config, reporter, suites)
    } catch (error) {
      throw new CriticalError(
        isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG',
        error.message
      )
    }

    hasLTD = triggerConfigs.some(isLocalTriggerConfig)

    if (triggerConfigs.length === 0) {
      throw new CiError('NO_TESTS_TO_RUN')
    }

    try {
      const triggerFromSearch = !!config.testSearchQuery
      let resolvedTestPlan: TestPlan
      ;({testPlan: resolvedTestPlan, initialSummary} = await getTestsToTrigger(
        api,
        triggerConfigs,
        reporter,
        triggerFromSearch,
        config.failOnMissingTests,
        config.tunnel
      ))
      overriddenTestsToTrigger = resolvedTestPlan.map((item) => item.testOverrides)
      tests = resolvedTestPlan.filter((item) => item.executionRule !== ExecutionRule.SKIPPED).map((item) => item.test)
      hasLTD = overriddenTestsToTrigger.some(isLocalTestPayload)
    } catch (error) {
      if (error instanceof CiError) {
        throw error
      }

      throw new CriticalError(
        isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG',
        error.message
      )
    }
  }

  // All tests have been skipped or are missing.
  if (!tests.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  const publicIdsToTrigger = tests.flatMap(({public_id}) => (public_id ? [public_id] : []))

  if (config.tunnel) {
    let presignedURL: string
    try {
      // Get the pre-signed URL to connect to the tunnel service
      presignedURL = (await api.getTunnelPresignedURL(publicIdsToTrigger)).url
    } catch (error) {
      throw new CriticalError('UNAVAILABLE_TUNNEL_CONFIG', error.message)
    }
    // Open a tunnel to Datadog
    try {
      const tunnelProxyAgent = getTunnelProxyAgent(config.proxy)
      const tunnelReporter = getTunnelReporter(reporter)
      tunnel = new Tunnel(presignedURL, publicIdsToTrigger, tunnelProxyAgent, tunnelReporter)

      const tunnelInfo = await tunnel.start()
      overriddenTestsToTrigger.forEach((testToTrigger) => {
        testToTrigger.tunnel = tunnelInfo
      })
    } catch (error) {
      await stopTunnel()
      throw new CriticalError('TUNNEL_START_FAILED', error.message)
    }
  }

  const metadata = getCIMetadata({
    [GIT_COMMIT_MESSAGE]: 500,
  })

  let trigger: TriggerInfo
  try {
    trigger = await runTests(
      api,
      overriddenTestsToTrigger,
      reporter,
      metadata,
      config.failOnMissingTests,
      config.selectiveRerun,
      config.batchTimeout
    )

    // Update summary
    const cannotRead = initialSummary.testsNotAuthorized
    const cannotWrite = trigger.testsNotAuthorized
    initialSummary.testsNotAuthorized = new Set([...cannotRead, ...cannotWrite])
    initialSummary.metadata = metadata
  } catch (error) {
    await stopTunnel()

    if (error instanceof CiError) {
      throw error
    }

    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  if (trigger.selectiveRerunRateLimited) {
    reporter.error('The selective rerun feature was rate-limited. All tests will be re-run.\n\n')
  }

  try {
    const {datadogSite, failOnCriticalErrors, failOnTimeout, subdomain} = config
    const batchTimeout = config.batchTimeout || DEFAULT_BATCH_TIMEOUT

    const results = await waitForResults(
      api,
      trigger,
      tests,
      {datadogSite, failOnCriticalErrors, failOnTimeout, subdomain, batchTimeout},
      reporter,
      tunnel
    )

    if (hasLTD) {
      try {
        await updateLTDMultiLocators(reporter, config, results)
      } catch (error) {
        throw new CriticalError('LTD_MULTILOCATORS_UPDATE_FAILED', error.message)
      }
    }

    return {
      results,
      summary: {
        ...initialSummary,
        batchId: trigger.batchId,
      },
    }
  } catch (error) {
    if (error instanceof BatchTimeoutRunawayError) {
      throw error
    }

    if (error instanceof CriticalError && error.code === 'LTD_MULTILOCATORS_UPDATE_FAILED') {
      throw error
    }

    throw new CriticalError('POLL_RESULTS_FAILED', error.message)
  } finally {
    await stopTunnel()
  }
}

export const getTriggerConfigs = async (
  api: APIHelper,
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  suites?: Suite[]
): Promise<TriggerConfig[]> => {
  // Grab the test config overrides from all the sources: default test config overrides, test files containing specific test config override, env variable, and CLI params
  const defaultTestConfigOverrides = config.defaultTestOverrides
  const testsFromTestConfigs = await getTestConfigs(config, reporter, suites)

  // Grab the tests returned by the search query (or `[]` if not given).
  const testsFromSearchQuery = await getTestsFromSearchQuery(api, config)

  // Grab the list of publicIds of tests to trigger from config file/env variable/CLI params, search query or test config files
  const testIdsFromCli = config.publicIds
  const testIdsFromSearchQuery = testsFromSearchQuery.map(({id}) => id)
  const testIdsFromTestConfigs = testsFromTestConfigs.map(getTriggerConfigPublicId).filter((p): p is string => !!p)

  // Take the list of tests from the first source that defines it, by order of precedence
  const testIdsToTrigger =
    [testIdsFromCli, testIdsFromSearchQuery, testIdsFromTestConfigs].find((ids) => ids.length > 0) ?? []

  // Create the overrides required for the list of tests to trigger
  const triggerConfigsWithId = testIdsToTrigger.map((id) => {
    // Parse public ID and version ID from the input
    const parsedId = parsePublicIdWithVersion(id)
    const publicId = parsedId?.publicId ?? id
    const version = parsedId?.version

    const testIndexFromSearchQuery = testsFromSearchQuery.findIndex((t) => t.id === publicId)
    let testFromSearchQuery
    if (testIndexFromSearchQuery >= 0) {
      testFromSearchQuery = testsFromSearchQuery.splice(testIndexFromSearchQuery, 1)[0]
    }

    const testIndexFromTestConfigs = testsFromTestConfigs.findIndex((t) => getTriggerConfigPublicId(t) === publicId)
    let testFromTestConfigs
    if (testIndexFromTestConfigs >= 0) {
      testFromTestConfigs = testsFromTestConfigs.splice(testIndexFromTestConfigs, 1)[0]
    }

    return {
      ...(isLocalTriggerConfig(testFromTestConfigs) ? {} : {id: publicId, version}),
      ...testFromSearchQuery,
      ...testFromTestConfigs,
      testOverrides: {
        ...defaultTestConfigOverrides,
        ...testFromTestConfigs?.testOverrides,
      },
    } as TriggerConfig
  })

  const localTriggerConfigsWithoutId = testsFromTestConfigs.flatMap((testConfig) => {
    if (!isLocalTriggerConfig(testConfig)) {
      return []
    }

    return [
      {
        ...testConfig,
        testOverrides: {
          ...defaultTestConfigOverrides,
          ...testConfig.testOverrides,
        },
      },
    ]
  })

  return triggerConfigsWithId.concat(localTriggerConfigsWithoutId)
}

export const planDryRun = async (
  reporter: MainReporter,
  runConfig: WrapperConfig,
  suites?: Suite[]
): Promise<{testPlan: TestPlan; initialSummary: InitialSummary}> => {
  const config = {
    ...getDefaultConfig(),
    ...runConfig,
  }
  const api = getApiHelper(config)
  let triggerConfigs: TriggerConfig[]

  try {
    triggerConfigs = await getTriggerConfigs(api, config, reporter, suites)
  } catch (error) {
    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }

  if (triggerConfigs.length === 0) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  try {
    const triggerFromSearch = !!config.testSearchQuery
    const {testPlan, initialSummary} = await getTestsToTrigger(
      api,
      triggerConfigs,
      reporter,
      triggerFromSearch,
      config.failOnMissingTests,
      false
    )

    return {testPlan, initialSummary}
  } catch (error) {
    if (error instanceof CiError) {
      throw error
    }

    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }
}

export const executeWithDetails = async (
  runConfig: WrapperConfig,
  {initialSummary, jUnitReport, reporters, runId, suites, testPlan}: ExecuteOptions
): Promise<{
  results: Result[]
  summary: Summary
  exitCode: 0 | 1
}> => {
  const startTime = Date.now()
  const localConfig = {
    ...getDefaultConfig(),
    ...runConfig,
  }

  // Handle reporters for the run.
  const localReporters: Reporter[] = []
  // If the config asks for specific reporters.
  if (reporters) {
    for (const reporter of reporters) {
      // Add our own reporters if required.
      if (reporter === 'junit') {
        localReporters.push(
          new JUnitReporter({
            context: process,
            jUnitReport: jUnitReport || './junit.xml',
            runName: `Run ${runId || 'undefined'}`,
          })
        )
      }
      if (reporter === 'default') {
        localReporters.push(new DefaultReporter({context: process}))
      }
      // This is a custom reporter, so simply add it.
      if (typeof reporter !== 'string') {
        localReporters.push(reporter)
      }
    }
  } else {
    localReporters.push(new DefaultReporter({context: process}))
  }

  const mainReporter = getReporter(localReporters)
  const {results, summary} = await executeTests(mainReporter, localConfig, suites, testPlan, initialSummary)

  const orgSettings = await getOrgSettings(mainReporter, localConfig)

  // XXX: Mutates the `summary` object.
  renderResults({
    config: localConfig,
    reporter: mainReporter,
    results,
    orgSettings,
    startTime,
    summary,
  })

  reportExitLogs(mainReporter, localConfig, {results})

  const exitCode = toExitCode(getExitReason(localConfig, {results}))

  return {
    results,
    summary,
    exitCode,
  }
}

export const execute = async (runConfig: WrapperConfig, executeOptions: ExecuteOptions): Promise<0 | 1> => {
  const {exitCode} = await executeWithDetails(runConfig, executeOptions)

  return exitCode
}
