import {getProxyAgent} from '../../helpers/utils'

import {APIHelper, getApiHelper, isForbiddenError} from './api'
import {CiError, CriticalError} from './errors'
import {
  MainReporter,
  Reporter,
  Result,
  RunTestsCommandConfig,
  Suite,
  Summary,
  SupportedReporter,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
  UserConfigOverride,
  WrapperConfig,
} from './interfaces'
import {DefaultReporter, getTunnelReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {DEFAULT_COMMAND_CONFIG, MAX_TESTS_TO_TRIGGER} from './run-tests-command'
import {Tunnel} from './tunnel'
import {
  getReporter,
  getOrgSettings,
  getSuites,
  getTestsToTrigger,
  InitialSummary,
  renderResults,
  runTests,
  waitForResults,
  getExitReason,
  toExitCode,
  reportExitLogs,
  normalizePublicId,
} from './utils/public'

type ExecuteOptions = {
  jUnitReport?: string
  reporters?: (SupportedReporter | Reporter)[]
  runId?: string
  suites?: Suite[]
}

export const executeTests = async (
  reporter: MainReporter,
  config: RunTestsCommandConfig,
  suites?: Suite[]
): Promise<{
  results: Result[]
  summary: Summary
}> => {
  const api = getApiHelper(config)
  let tunnel: Tunnel | undefined
  let triggerConfigs: TriggerConfig[] = []

  const stopTunnel = async () => {
    if (tunnel) {
      await tunnel.stop()
    }
  }

  try {
    triggerConfigs = await getTriggerConfigs(api, config, reporter, suites)
  } catch (error) {
    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }

  if (triggerConfigs.length === 0) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  let testsToTriggerResult: {
    initialSummary: InitialSummary
    overriddenTestsToTrigger: TestPayload[]
    tests: Test[]
  }

  try {
    const triggerFromSearch = !!config.testSearchQuery
    testsToTriggerResult = await getTestsToTrigger(
      api,
      triggerConfigs,
      reporter,
      triggerFromSearch,
      config.failOnMissingTests,
      config.tunnel
    )
  } catch (error) {
    if (error instanceof CiError) {
      throw error
    }

    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }

  const {tests, overriddenTestsToTrigger, initialSummary} = testsToTriggerResult

  // All tests have been skipped or are missing.
  if (!tests.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  const publicIdsToTrigger = tests.map(({public_id}) => public_id)

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
      const tunnelProxyAgent = getProxyAgent(config.proxy)
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

  let trigger: Trigger
  try {
    trigger = await runTests(api, overriddenTestsToTrigger, config.selectiveRerun)
  } catch (error) {
    await stopTunnel()
    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  try {
    const maxPollingTimeout = Math.max(...triggerConfigs.map((t) => t.config.pollingTimeout || config.pollingTimeout))
    const {datadogSite, failOnCriticalErrors, failOnTimeout, subdomain} = config

    const results = await waitForResults(
      api,
      trigger,
      tests,
      {datadogSite, failOnCriticalErrors, failOnTimeout, subdomain, maxPollingTimeout},
      reporter,
      tunnel
    )

    return {
      results,
      summary: {
        ...initialSummary,
        batchId: trigger.batch_id,
      },
    }
  } catch (error) {
    if (error instanceof CriticalError && error.code === 'SAFE_DEADLINE_REACHED') {
      throw error
    }

    throw new CriticalError('POLL_RESULTS_FAILED', error.message)
  } finally {
    await stopTunnel()
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
export const getTriggerConfigs = async (
  api: APIHelper,
  config: RunTestsCommandConfig,
  reporter: MainReporter,
  suites?: Suite[]
): Promise<TriggerConfig[]> => {
  // Grab the test config overrides from all the sources: default test config overrides, test files containing specific test config override, env variable, and cli params
  const defaultTestConfigOverrides = config.global
  // TODO: Clean up locations as part of SYNTH-12989
  const testConfigOverridesFromEnv = config.locations?.length ? {locations: config.locations} : {}
  const testsFromTestConfigs = await getTestConfigs(config, reporter, suites)

  // Grab the test defined from the search query. Their config will contain the suite name, and the search query itself.
  const testsFromSearchQuery = config.testSearchQuery ? await getTestsFromSearchQuery(api, config, reporter) : []

  // Grab the list of publicIds of tests to trigger from config file/env variable/CLI params, search query or test config files
  const testIdsFromCli = config.publicIds
  const testIdsFromSearchQuery = testsFromSearchQuery.map(({id}) => id)
  const testIdsFromTestConfigs = testsFromTestConfigs.map(({id}) => id)

  // Take the list of tests from the first source that defines it, by order of precedence
  const testIdsToTrigger =
    [testIdsFromCli, testIdsFromSearchQuery, testIdsFromTestConfigs].find((ids) => ids.length > 0) ?? []

  // Create the overrides required for the list of tests to trigger
  const triggerConfigs = testIdsToTrigger.map((id) => {
    const testFromSearchQuery = testsFromSearchQuery.find((test) => test.id === id)
    const testFromTestConfigs = testsFromTestConfigs.find((test) => test.id === id)

    return {
      id,
      ...testFromSearchQuery,
      ...testFromTestConfigs,
      config: {
        ...defaultTestConfigOverrides,
        ...testConfigOverridesFromEnv,
        ...testFromTestConfigs?.config,
      },
    }
  })

  return triggerConfigs
}

const getTestsFromSearchQuery = async (api: APIHelper, config: RunTestsCommandConfig, reporter: MainReporter) => {
  const testsToTriggerBySearchQuery = await getTestListBySearchQuery(api, config.global, config.testSearchQuery || '')

  if (testsToTriggerBySearchQuery.length > MAX_TESTS_TO_TRIGGER) {
    reporter.error(
      `More than ${MAX_TESTS_TO_TRIGGER} tests returned by search query, only the first ${MAX_TESTS_TO_TRIGGER} will be fetched.\n`
    )
  }

  if (testsToTriggerBySearchQuery.length === 0) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  return testsToTriggerBySearchQuery
}

const getTestConfigs = async (
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

export const executeWithDetails = async (
  runConfig: WrapperConfig,
  {jUnitReport, reporters, runId, suites}: ExecuteOptions
): Promise<{
  results: Result[]
  summary: Summary
  exitCode: 0 | 1
}> => {
  const startTime = Date.now()
  const localConfig = {
    ...DEFAULT_COMMAND_CONFIG,
    ...runConfig,
  }

  // We don't want to have default globs in case suites are given.
  if (!runConfig.files && suites?.length) {
    localConfig.files = []
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
  const {results, summary} = await executeTests(mainReporter, localConfig, suites)

  const orgSettings = await getOrgSettings(mainReporter, localConfig)

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
