import {writeFileSync} from 'node:fs'
import http from 'node:http'

import chalk from 'chalk'
import cliProgress from 'cli-progress'
import terminalLink from 'terminal-link'

import {getProxyAgent} from '../../helpers/utils'

import {APIHelper, getApiHelper, isForbiddenError} from './api'
import {runTests, waitForResults} from './batch'
import {CiError, CriticalError, BatchTimeoutRunawayError} from './errors'
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
  WrapperConfig,
} from './interfaces'
import {updateLTDMultiLocators} from './multilocator'
import {DefaultReporter, getTunnelReporter} from './reporters/default'
import {DeferredReporter} from './reporters/deferred'
import {JUnitReporter} from './reporters/junit'
import {DEFAULT_BATCH_TIMEOUT, DEFAULT_COMMAND_CONFIG} from './run-tests-command'
import {getTestConfigs, getTestsFromSearchQuery, getTestsToTrigger} from './test'
import {Tunnel} from './tunnel'
import {getTriggerConfigPublicId, isLocalTriggerConfig} from './utils/internal'
import {
  getReporter,
  getOrgSettings,
  InitialSummary,
  renderResults,
  getExitReason,
  toExitCode,
  reportExitLogs,
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
  let reportServer: http.Server | undefined
  let triggerConfigs: TriggerConfig[] = []

  const stopTunnel = async () => {
    if (tunnel) {
      await tunnel.stop()
    }
    if (reportServer) {
      reportServer.closeAllConnections()
      reportServer.close()
    }
  }

  try {
    triggerConfigs = await getTriggerConfigs(api, config, reporter, suites)
  } catch (error) {
    throw new CriticalError(isForbiddenError(error) ? 'AUTHORIZATION_ERROR' : 'UNAVAILABLE_TEST_CONFIG', error.message)
  }

  let hasLTD = false
  for (const triggerConfig of triggerConfigs) {
    if (isLocalTriggerConfig(triggerConfig)) {
      hasLTD = true
      break
    }
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

  const publicIdsToTrigger = tests.flatMap(({public_id}) => (public_id ? [public_id] : []))

  const fPublicId = chalk.dim(`{publicId}`)
  const fBar = chalk.cyan(`{bar}`)
  const fUrl = terminalLink('link', '{url}')

  const multiBar = new cliProgress.MultiBar(
    {
      clearOnComplete: true,
      hideCursor: true,
      barCompleteChar: '=',
      barIncompleteChar: ' ',
      format: ` {icon} [${fPublicId}] [${fBar}] - Step {value}/{total} (${fUrl})`,
    },
    cliProgress.Presets.shades_grey
  )

  const deferredReporter = new DeferredReporter()

  if (config.tunnel) {
    const bars = new Map<string, cliProgress.Bar>()
    const inProgressResults = new Map<string, {startedAt: number; steps: any[]; status: 'in_progress' | 'finished'}>()

    reportServer = http
      .createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Headers', '*')
          res.statusCode = 200

          if (req.method === 'OPTIONS') {
            res.end()

            return
          }

          if (req.method === 'GET' && req.url?.includes('/synthetics')) {
            const match = req.url?.match(/\/synthetics\/tests\/(?<testId>[^/]+)\/results\/(?<resultId>[^/]+)/)
            // console.log('received req on', req.url)
            if (match?.groups) {
              const {resultId} = match.groups
              const result = inProgressResults.get(resultId) ?? {
                startedAt: Date.now(),
                steps: [],
                status: 'in_progress',
              }

              // console.log('Returned result', {status: result.status, resultId})

              res.setHeader('Content-Type', 'application/json')
              res.write(JSON.stringify(result))
            } else {
              res.statusCode = 404
            }
          } else {
            const {startedAt, stepIndex, stepCount, stepResult, publicId, resultId, status, retrying} = JSON.parse(body)

            const result = inProgressResults.get(resultId) ?? {startedAt, steps: [], status: 'in_progress'}
            const url = `https://dd-cc0f04065bf75f0aff85d7d0e62d9a6f.datad0g.com/synthetics/details/${publicId}/result/${resultId}?batch_id=${trigger.batch_id}&port=3222`
            const payload = {url, publicId, icon: status === 'finished' ? '•' : '⏳'}

            const bar = bars.get(resultId) ?? multiBar.create(0, 0)
            bars.set(resultId, bar)

            if (status === 'finished' && inProgressResults.get(resultId)) {
              // console.log('Finishing', resultId)
              result.status = 'finished'
              bar.update(payload)
            } else {
              const error = retrying?.error || stepResult.error
              if (error?.code === 'ASSERTION_FAILURE') {
                const retries: number = retrying?.retries || 0
                const retryText = retrying ? ` (attempt ${retries + 1})` : ''

                writeFileSync(
                  `/Users/corentin.girard/go/src/github.com/DataDog/datadog-ci.git/tests-as-code/step-result-${retryText}.json`,
                  JSON.stringify(stepResult)
                )

                multiBar.log(
                  `${chalk.dim(`[${publicId}]`)} ${chalk.red('[ASSERTION_FAILURE]')} - ${
                    stepResult.description
                  }${retryText}\n ${chalk.red('✖')} Expected "${stepResult.assertionResult.expected}" but got "${
                    stepResult.assertionResult.actual
                  }"\n\n`
                )
              }

              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/restrict-plus-operands
              bar.start(stepCount, stepIndex + 1, payload)

              result.steps[stepIndex] = {
                ...stepResult,
                displayIndex: stepIndex,
              }

              // writeFileSync(
              //   '/Users/corentin.girard/go/src/github.com/DataDog/datadog-ci.git/tests-as-code/step-result.json',
              //   JSON.stringify(stepResult)
              // )
            }

            inProgressResults.set(resultId, result)
          }

          res.end()
        })
      })
      .listen(3222)

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
    trigger = await runTests(api, overriddenTestsToTrigger, config.selectiveRerun, config.batchTimeout)
  } catch (error) {
    await stopTunnel()
    multiBar.stop()
    throw new CriticalError('TRIGGER_TESTS_FAILED', error.message)
  }

  if (trigger.selective_rerun_rate_limited) {
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
      deferredReporter,
      tunnel
    )

    multiBar.stop()
    deferredReporter.flush()

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
        batchId: trigger.batch_id,
      },
    }
  } catch (error) {
    multiBar.stop()
    deferredReporter.flush()

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
    const testIndexFromSearchQuery = testsFromSearchQuery.findIndex((t) => t.id === id)
    let testFromSearchQuery
    if (testIndexFromSearchQuery >= 0) {
      testFromSearchQuery = testsFromSearchQuery.splice(testIndexFromSearchQuery, 1)[0]
    }

    const testIndexFromTestConfigs = testsFromTestConfigs.findIndex((t) => getTriggerConfigPublicId(t) === id)
    let testFromTestConfigs
    if (testIndexFromTestConfigs >= 0) {
      testFromTestConfigs = testsFromTestConfigs.splice(testIndexFromTestConfigs, 1)[0]
    }

    return {
      ...(isLocalTriggerConfig(testFromTestConfigs) ? {} : {id}),
      ...testFromSearchQuery,
      ...testFromTestConfigs,
      testOverrides: {
        ...defaultTestConfigOverrides,
        ...testFromTestConfigs?.testOverrides,
      },
    } as TriggerConfig
  })

  return triggerConfigsWithId
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
