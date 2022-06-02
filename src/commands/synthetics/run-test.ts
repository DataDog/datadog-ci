import {apiConstructor, APIHelper, isForbiddenError} from './api'
import {CiError, CriticalError} from './errors'
import {
  CommandConfig,
  MainReporter,
  Suite,
  Summary,
  SyntheticsCIConfig,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
} from './interfaces'
import {Tunnel} from './tunnel'
import {getSuites, getTestsToTrigger, runTests, waitForResults} from './utils'

export const executeTests = async (reporter: MainReporter, config: CommandConfig, suites?: Suite[]) => {
  const api = getApiHelper(config)

  const publicIdsFromCli = config.publicIds.map((id) => ({config: config.global, id}))
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
    overriddenTestsToTrigger: TestPayload[]
    summary: Summary
    tests: Test[]
  }

  try {
    testsToTriggerResult = await getTestsToTrigger(api, testsToTrigger, reporter)
  } catch (error) {
    if (error instanceof CiError) {
      throw error
    }

    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }

  const {tests, overriddenTestsToTrigger, summary} = testsToTriggerResult

  // All tests have been skipped or are missing.
  if (!tests.length) {
    throw new CiError('NO_TESTS_TO_RUN')
  }

  const publicIdsToTrigger = tests.map(({public_id}) => public_id)

  if (config.tunnel) {
    let presignedURL: string
    try {
      // Get the pre-signed URL to connect to the tunnel service
      presignedURL = (await api.getPresignedURL(publicIdsToTrigger)).url
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

  let triggers: Trigger
  try {
    triggers = await runTests(api, overriddenTestsToTrigger)
  } catch (error) {
    await stopTunnel()
    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  if (!triggers.results) {
    await stopTunnel()
    throw new CiError('NO_RESULTS_TO_POLL')
  }

  try {
    const results = await waitForResults(
      api,
      triggers.results,
      testsToTrigger,
      tests,
      {
        defaultTimeout: config.pollingTimeout,
        failOnCriticalErrors: config.failOnCriticalErrors,
        failOnTimeout: config.failOnTimeout,
      },
      reporter,
      tunnel
    )

    return {results, summary, tests, triggers}
  } catch (error) {
    throw new CriticalError('POLL_RESULTS_FAILED', error.message)
  } finally {
    await stopTunnel()
  }
}

export const getTestsList = async (
  api: APIHelper,
  config: SyntheticsCIConfig,
  reporter: MainReporter,
  suites: Suite[] = []
) => {
  // If "testSearchQuery" is provided, always default to running it.
  if (config.testSearchQuery) {
    const testSearchResults = await api.searchTests(config.testSearchQuery)

    return testSearchResults.tests.map((test) => ({
      config: config.global,
      id: test.public_id,
      suite: `Query: ${config.testSearchQuery}`,
    }))
  }

  const suitesFromFiles = (await Promise.all(config.files.map((glob: string) => getSuites(glob, reporter!))))
    .reduce((acc, val) => acc.concat(val), [])
    .filter((suite) => !!suite.content.tests)

  suites.push(...suitesFromFiles)

  const configFromEnvironment = config.locations?.length ? {locations: config.locations} : {}
  const testsToTrigger = suites
    .map((suite) =>
      suite.content.tests.map((test) => ({
        config: {
          ...config.global,
          ...configFromEnvironment,
          ...test.config,
        },
        id: test.id,
        suite: suite.name,
      }))
    )
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])

  return testsToTrigger
}

export const getApiHelper = (config: SyntheticsCIConfig) => {
  if (!config.appKey) {
    throw new CriticalError('MISSING_APP_KEY')
  }
  if (!config.apiKey) {
    throw new CriticalError('MISSING_API_KEY')
  }

  return apiConstructor({
    apiKey: config.apiKey!,
    appKey: config.appKey!,
    baseIntakeUrl: getDatadogHost(true, config),
    baseUrl: getDatadogHost(false, config),
    proxyOpts: config.proxy,
  })
}

export const getDatadogHost = (useIntake = false, config: SyntheticsCIConfig) => {
  const apiPath = 'api/v1'
  let host = `https://api.${config.datadogSite}`
  const hostOverride = process.env.DD_API_HOST_OVERRIDE

  if (hostOverride) {
    host = hostOverride
  } else if (useIntake && (config.datadogSite === 'datadoghq.com' || config.datadogSite === 'datad0g.com')) {
    host = `https://intake.synthetics.${config.datadogSite}`
  }

  return `${host}/${apiPath}`
}
