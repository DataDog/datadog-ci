import {APIHelper, getApiHelper, isForbiddenError} from './api'
import {MAX_TESTS_TO_TRIGGER} from './command'
import {CiError, CriticalError} from './errors'
import {
  Batch,
  CommandConfig,
  ExecutionRule,
  MainReporter,
  Result,
  ResultInBatch,
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

// Tunnel cache?

export interface TestDriver {
  // Disposes the drivers
  // Does not throw
  dispose(): void

  // Rejects batchId is unknown
  // should dispose any information about the batchId after it's not 'in-progress'
  refresh(batchId: string): Promise<Batch>

  // Rejects if unsupported config
  start(config: CommandConfig, suites?: Suite[]): Promise<Trigger>

  // Do not reject for unknown batchId
  stop(batchId: string): Promise<void>
}

export const createTestDriver = (): TestDriver => {
  const batchData: {
    [batchId: string]: {
      isTunnelConnected?: boolean
      startTestResult: StartTestResult
    }
  } = {}

  const stopBatch = async (data: typeof batchData['string']) => {
    if (data) {
      delete batchData[data.startTestResult.trigger.batch_id]

      const {stopTunnel} = data.startTestResult
      await stopTunnel()
    }
  }

  const reportedErrors: string[] = []
  const reporter: MainReporter = {
    error: (error: string) => {
      reportedErrors.push(error)
    },

    initErrors: (errors: string[]) => {
      reportedErrors.push(...errors)
    },

    log: (log: string) => {
      // Ignore
    },

    reportStart: (timings: {startTime: number}) => {
      // Ignore
    },

    resultEnd: (result: Result, baseUrl: string) => {
      // Ignore
    },

    resultReceived: (result: ResultInBatch) => {
      // Ignore
    },

    runEnd: (summary: Summary, baseUrl: string) => {
      // Ignore
    },

    testsWait: (tests: Test[]) => {
      // Ignore
    },

    testTrigger: (test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride) => {
      // Ignore
    },

    testWait: (test: Test) => {
      // Ignore
    },
  }

  return {
    dispose: () => {
      const batchIds = Object.keys(batchData)
      const dataArray = batchIds.map((batchId) => {
        const data = batchData[batchId]
        delete batchData[batchId]

        return data
      })

      dataArray.forEach((data) => {
        stopBatch(data)
      })
    },

    start: async (config: CommandConfig, suites?: Suite[]) => {
      const startTestResult = await startTest(reporter, config, suites)

      const data: typeof batchData['string'] = {startTestResult}

      if (reportedErrors.length) {
        stopBatch(data)
        throw new Error(reportedErrors.join('\n'))
      }

      batchData[startTestResult.trigger.batch_id] = data

      return startTestResult.trigger
    },

    refresh: async (batchId: string) => {
      const data = batchData[batchId]
      if (!data) {
        throw new Error(`Unknown batch id '${batchId}`)
      }

      const {api, tunnel, trigger} = data.startTestResult

      if (data.isTunnelConnected === undefined) {
        if (tunnel) {
          data.isTunnelConnected = true
          tunnel
            .keepAlive()
            .then(() => (data.isTunnelConnected = false))
            .catch(() => (data.isTunnelConnected = false))
        } else {
          data.isTunnelConnected = false
        }
      }

      let batch: Batch

      try {
        batch = await api.getBatch(trigger.batch_id)
      } catch (error) {
        stopBatch(data)
        throw error
      }

      if (reportedErrors.length) {
        stopBatch(data)
        throw new Error(reportedErrors.join('\n'))
      }

      if (batch.status !== 'in_progress') {
        if (tunnel && !data.isTunnelConnected) {
          await stopBatch(data)
          throw new Error('The tunnel has stopped working, this may have affected the results.')
        }
      } else {
        await stopBatch(data)
      }

      return batch
    },

    stop: (batchId: string) => stopBatch(batchData[batchId]),
  }
}

export const executeTests = async (
  reporter: MainReporter,
  config: CommandConfig,
  suites?: Suite[]
): Promise<{
  results: Result[]
  summary: Summary
}> => {
  const startTestResult = await startTest(reporter, config, suites)

  return waitForTests(startTestResult)
}

type StartTestResult = {
  api: APIHelper
  config: CommandConfig
  initialSummary: InitialSummary
  reporter: MainReporter
  tests: Test[]
  testsToTrigger: TriggerConfig[]
  trigger: Trigger
  tunnel?: Tunnel
  stopTunnel(): Promise<void>
}

export const startTest = async (
  reporter: MainReporter,
  config: CommandConfig,
  suites?: Suite[]
): Promise<StartTestResult> => {
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
    testsToTriggerResult = await getTestsToTrigger(
      api,
      testsToTrigger,
      reporter,
      triggerFromSearch,
      config.failOnMissingTests
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
  } catch (error) {
    await stopTunnel()
    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  return {api, config, reporter, tests, testsToTrigger, initialSummary, tunnel, stopTunnel, trigger}
}

const waitForTests = async (startResult: StartTestResult) => {
  const {api, config, reporter, tests, testsToTrigger, initialSummary, tunnel, stopTunnel, trigger} = startResult
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
