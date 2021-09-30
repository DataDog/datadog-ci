import {apiConstructor, is5xxError} from './api'
import {CiError, CriticalError} from './errors'
import {
  APIHelper,
  CommandConfig,
  MainReporter,
  PollResult,
  Summary,
  Test,
  TestPayload,
  Trigger,
  TriggerConfig,
} from './interfaces'
import {Tunnel} from './tunnel'
import {getSuites, getTestsToTrigger, runTests, waitForResults} from './utils'

export const executeTests = async (reporter: MainReporter, config: CommandConfig) => {
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
      testsToTrigger = await getTestsList(api, config, reporter)
    } catch (error) {
      const isCriticalError = is5xxError(error as any)
      await stopTunnel()
      throw new (isCriticalError ? CriticalError : CiError)('UNAVAILABLE_TEST_CONF')
    }
  }

  if (!testsToTrigger.length) {
    await stopTunnel()
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
    const isCriticalError = is5xxError(error as any)
    await stopTunnel()
    throw new (isCriticalError ? CriticalError : CiError)('UNAVAILABLE_TEST_CONF')
  }

  const {tests, overriddenTestsToTrigger, summary} = testsToTriggerResult

  // All tests have been skipped or are missing.
  if (!tests.length) {
    await stopTunnel()
    throw new CiError('NO_TESTS_TO_RUN')
  }

  const publicIdsToTrigger = tests.map(({public_id}) => public_id)

  if (config.tunnel) {
    let presignedURL: string
    try {
      // Get the pre-signed URL to connect to the tunnel service
      presignedURL = (await api.getPresignedURL(publicIdsToTrigger)).url
    } catch (error) {
      const isCriticalError = is5xxError(error as any)
      await stopTunnel()
      throw new (isCriticalError ? CriticalError : CiError)('UNAVAILABLE_TUNNEL_CONF')
    }
    // Open a tunnel to Datadog
    try {
      tunnel = new Tunnel(presignedURL, publicIdsToTrigger, config.proxy, reporter)
      const tunnelInfo = await tunnel.start()
      overriddenTestsToTrigger.forEach((testToTrigger) => {
        testToTrigger.tunnel = tunnelInfo
      })
    } catch (error) {
      const isCriticalError = is5xxError(error as any)
      await stopTunnel()
      throw new (isCriticalError ? CriticalError : CiError)('TUNNEL_START_FAILED')
    }
  }

  let triggers: Trigger
  try {
    triggers = await runTests(api, overriddenTestsToTrigger)
  } catch (error) {
    const isCriticalError = is5xxError(error as any)
    await stopTunnel()
    throw new (isCriticalError ? CriticalError : CiError)('TRIGGER_TESTS_FAILED')
  }

  if (!triggers.results) {
    throw new Error('No result to poll.')
  }

  const results: {[key: string]: PollResult[]} = {}
  try {
    // Poll the results.
    const resultPolled = await waitForResults(
      api,
      triggers.results,
      config.pollingTimeout,
      testsToTrigger,
      tunnel,
      config.failOnCriticalErrors
    )
    Object.assign(results, resultPolled)
  } catch (error) {
    const isCriticalError = is5xxError(error as any)
    await stopTunnel()
    throw new (isCriticalError ? CriticalError : CiError)('POLL_RESULTS_FAILED')
  }

  return {results, summary, tests, triggers}
}

export const getTestsList = async (api: APIHelper, config: CommandConfig, reporter: MainReporter) => {
  if (config.testSearchQuery) {
    const testSearchResults = await api.searchTests(config.testSearchQuery)

    return testSearchResults.tests.map((test) => ({config: config.global, id: test.public_id}))
  }

  const suites = (await Promise.all(config.files.map((glob: string) => getSuites(glob, reporter!))))
    .reduce((acc, val) => acc.concat(val), [])
    .map((suite) => suite.tests)
    .filter((suiteTests) => !!suiteTests)

  const configFromEnvironment = config.locations?.length ? {locations: config.locations} : {}
  const testsToTrigger = suites
    .reduce((acc, suiteTests) => acc.concat(suiteTests), [])
    .map((test) => ({
      config: {
        ...config.global,
        ...configFromEnvironment,
        ...test.config,
      },
      id: test.id,
    }))

  return testsToTrigger
}

export const getApiHelper = (config: CommandConfig) => {
  if (!config.appKey) {
    throw new CiError('MISSING_APP_KEY')
  }
  if (!config.apiKey) {
    throw new CiError('MISSING_API_KEY')
  }

  return apiConstructor({
    apiKey: config.apiKey!,
    appKey: config.appKey!,
    baseIntakeUrl: getDatadogHost(true, config),
    baseUrl: getDatadogHost(false, config),
    proxyOpts: config.proxy,
  })
}

export const getDatadogHost = (useIntake = false, config: CommandConfig) => {
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
