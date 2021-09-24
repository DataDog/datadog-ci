
import chalk from 'chalk'
import {is5xxError} from './api'
import { 
    APIHelper,
    CommandConfig,
    ExecutionRule,
    LocationsMapping,
    MainReporter,
    PollResult,
    Summary,
    Test,
    TestPayload,
    Trigger,
    TriggerConfig
} from './interfaces'
import {Tunnel} from './tunnel'
import {
    getTestsToTrigger,
    hasTestSucceeded,
    isCriticalError,
    runTests,
    waitForResults,
  } from './utils'

export const executeTests = async (reporter: MainReporter, config:CommandConfig, getApiHelper: () => any, getTestsList: (api: APIHelper) => any, sortTestsByOutcome: (results: { [key: string]: PollResult[]; }) => any, getAppBaseURL: ()=>any) => { 
    const startTime = Date.now()
    const api = getApiHelper()
    const publicIdsFromCli = config.publicIds.map((id) => ({config: config.global, id}))
    let testsToTrigger: TriggerConfig[]
    let tunnel: Tunnel | undefined
    const safeExit = async (exitCode: 0 | 1) => {
    if (tunnel) {
        await tunnel.stop()
    }

    return exitCode
    }

    if (publicIdsFromCli.length) {
    testsToTrigger = publicIdsFromCli
    } else {
    try {
        testsToTrigger = await getTestsList(api)
    } catch (error) {
        reporter.error(
        `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations with search query ')}\n${
            error.message
        }\n\n`
        )

        if (is5xxError(error) && !config.failOnCriticalErrors) {
        return safeExit(0)
        }

        return safeExit(1)
    }
    }

    if (!testsToTrigger.length) {
    reporter.log('No test suites to run.\n')

    return safeExit(0)
    }

    let testsToTriggerResult: {
    overriddenTestsToTrigger: TestPayload[]
    summary: Summary
    tests: Test[]
    }

    try {
    testsToTriggerResult = await getTestsToTrigger(api, testsToTrigger, reporter)
    } catch (error) {
    reporter.error(
        `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations ')}\n${error.message}\n\n`
    )

    if (is5xxError(error) && !config.failOnCriticalErrors) {
        return safeExit(0)
    }

    return safeExit(1)
    }

    const {tests, overriddenTestsToTrigger, summary} = testsToTriggerResult

    // All tests have been skipped or are missing.
    if (!tests.length) {
    reporter.log('No test to run.\n')

    return safeExit(0)
    }

    const publicIdsToTrigger = tests.map(({public_id}) => public_id)

    if (config.tunnel) {
    reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
    )

    let presignedURL: string
    try {
        // Get the pre-signed URL to connect to the tunnel service
        presignedURL = (await api.getPresignedURL(publicIdsToTrigger)).url
    } catch (e) {
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration')}\n${e.message}\n\n`)
        if (is5xxError(e) && !config.failOnCriticalErrors) {
        return safeExit(0)
        }

        return safeExit(1)
    }
    // Open a tunnel to Datadog
    try {
        tunnel = new Tunnel(presignedURL, publicIdsToTrigger, config.proxy,reporter)
        const tunnelInfo = await tunnel.start()
        overriddenTestsToTrigger.forEach((testToTrigger) => {
        testToTrigger.tunnel = tunnelInfo
        })
    } catch (e) {
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to start tunnel ')}\n${e.message}\n\n`)

        if (is5xxError(e) && !config.failOnCriticalErrors) {
        return safeExit(0)
        }

        return safeExit(1)
    }
    }

    let triggers: Trigger
    try {
    triggers = await runTests(api, overriddenTestsToTrigger)
    } catch (e) {
    reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to trigger tests ')}\n${e.message}\n\n`)

    if (is5xxError(e) && !config.failOnCriticalErrors) {
        return safeExit(0)
    }

    return safeExit(1)
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
    reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${error.message}\n\n`)

    if (is5xxError(error) && !config.failOnCriticalErrors) {
        return safeExit(0)
    }

    return safeExit(1)
    }

    // Sort tests to show success first then non blocking failures and finally blocking failures.
    tests.sort(sortTestsByOutcome(results))

    // Rendering the results.
    reporter.reportStart({startTime})
    const locationNames = triggers.locations.reduce((mapping, location) => {
    mapping[location.id] = location.display_name

    return mapping
    }, {} as LocationsMapping)
    let hasSucceeded = true // Determine if all the tests have succeeded
    for (const test of tests) {
    const testResults = results[test.public_id]
    if (!config.failOnTimeout) {
        if (!summary.timedOut) {
        summary.timedOut = 0
        }

        const hasTimeout = testResults.some((pollResult) => pollResult.result.error === 'Timeout')
        if (hasTimeout) {
        summary.timedOut++
        }
    }

    if (!config.failOnCriticalErrors) {
        if (!summary.criticalErrors) {
        summary.criticalErrors = 0
        }
        const hasCriticalErrors = testResults.some((pollResult) => isCriticalError(pollResult.result))
        if (hasCriticalErrors) {
        summary.criticalErrors++
        }
    }

    const passed = hasTestSucceeded(testResults, config.failOnCriticalErrors, config.failOnTimeout)
    if (passed) {
        summary.passed++
    } else {
        summary.failed++
        if (test.options.ci?.executionRule !== ExecutionRule.NON_BLOCKING) {
        hasSucceeded = false
        }
    }

    reporter.testEnd(
        test,
        testResults,
        getAppBaseURL(),
        locationNames,
        config.failOnCriticalErrors,
        config.failOnTimeout
    )
    }

    reporter.runEnd(summary)

    return safeExit(hasSucceeded ? 0 : 1)
}