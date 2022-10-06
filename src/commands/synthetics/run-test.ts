import {APIHelper, getApiHelper, isForbiddenError} from './api'
import {MAX_TESTS_TO_TRIGGER} from './command'
import {CiError, CriticalError} from './errors'
import {
  CommandConfig,
  MainReporter,
  Result,
  Suite,
  Summary,
  SyntheticsCIConfig,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
  UserConfigOverride,
} from './interfaces'
import {Tunnel} from './tunnel'
import {getSuites, getTestsToTrigger, InitialSummary, runTests, waitForResults} from './utils'

export const executeTests = async (
  reporter: MainReporter,
  config: CommandConfig,
  suites?: Suite[]
): Promise<{
  results: Result[]
  summary: Summary
}> => {
  const api = getApiHelper(config)

  const publicIdsFromCli = config.publicIds.map((id) => ({
    config: {
      ...config.global,
      ...(config.locations?.length ? {locations: config.locations} : {}),
    },
    id,
  }))
  let testsToTrigger: TriggerConfig[]
  let tunnel: Tunnel | undefined

  const stopTunnel = async () => {
    if (tunnel) {
      await tunnel.stop()
    }
  }

  if (publicIdsFromCli.length) {
    testsToTrigger = publicIdsFromCli
  } else {
    try {
      testsToTrigger = await getTestsList(api, config, reporter, suites)
    } catch (error) {
      throw new CriticalError(
        isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG',
        error.message
      )
    }
  }

  if (!testsToTrigger.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  let testsToTriggerResult: {
    initialSummary: InitialSummary
    overriddenTestsToTrigger: TestPayload[]
    tests: Test[]
  }

  try {
    const triggerFromSearch = !!config.testSearchQuery
    testsToTriggerResult = await getTestsToTrigger(api, testsToTrigger, reporter, triggerFromSearch)
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
      tunnel = new Tunnel(presignedURL, publicIdsToTrigger, config.proxy, reporter)
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
    trigger = await runTests(api, overriddenTestsToTrigger)
    reporter.runStart(trigger)
  } catch (error) {
    await stopTunnel()
    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  try {
    const maxPollingTimeout = Math.max(...testsToTrigger.map((t) => t.config.pollingTimeout || config.pollingTimeout))
    const results = await waitForResults(
      api,
      trigger,
      tests,
      {
        failOnCriticalErrors: config.failOnCriticalErrors,
        failOnTimeout: config.failOnTimeout,
        maxPollingTimeout,
        pollingInterval: config.pollingInterval,
      },
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

export const getTestsList = async (
  api: APIHelper,
  config: SyntheticsCIConfig,
  reporter: MainReporter,
  suites: Suite[] = []
) => {
  // If "testSearchQuery" is provided, always default to running it.
  if (config.testSearchQuery) {
    const testsToTriggerBySearchQuery = await getTestListBySearchQuery(api, config.global, config.testSearchQuery)

    if (testsToTriggerBySearchQuery.length > MAX_TESTS_TO_TRIGGER) {
      reporter.error(
        `More than ${MAX_TESTS_TO_TRIGGER} tests returned by search query, only the first ${MAX_TESTS_TO_TRIGGER} will be fetched.\n`
      )
    }

    return testsToTriggerBySearchQuery
  }

  const suitesFromFiles = (await Promise.all(config.files.map((glob: string) => getSuites(glob, reporter!))))
    .reduce((acc, val) => acc.concat(val), [])
    .filter((suite) => !!suite.content.tests)

  suites.push(...suitesFromFiles)

  const configFromEnvironment = config.locations?.length ? {locations: config.locations} : {}

  const overrideTestConfig = (test: TriggerConfig): UserConfigOverride =>
    // Global < env < test config
    ({
      ...config.global,
      ...configFromEnvironment,
      ...test.config,
    })

  const testsToTrigger = suites
    .map((suite) =>
      suite.content.tests.map((test) => ({
        config: overrideTestConfig(test),
        id: test.id,
        suite: suite.name,
      }))
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testsToTrigger
}
