import chalk from 'chalk'
import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {parseConfigFile} from '../../helpers/utils'
import {apiConstructor} from './api'
import {APIHelper, CommandConfig, ExecutionRule, LocationsMapping, MainReporter, PollResult, Test} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {Tunnel} from './tunnel'
import {getReporter, getSuites, getTestsToTrigger, hasTestSucceeded, runTests, waitForResults} from './utils'

export const DEFAULT_COMMAND_CONFIG: CommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  pollingTimeout: 2 * 60 * 1000,
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
  tunnel: false,
}

export class RunTestCommand extends Command {
  private apiKey?: string
  private appKey?: string
  private config: CommandConfig = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests
  private configPath?: string
  private files?: string[]
  private publicIds?: string[]
  private reporter?: MainReporter
  private shouldOpenTunnel?: boolean
  private testSearchQuery?: string

  public async execute() {
    await this.resolveConfig()
    const reporters = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)
    const startTime = Date.now()

    const api = this.getApiHelper()
    const publicIdsFromCli = this.config.publicIds.map((id) => ({config: this.config.global, id}))
    const testsToTrigger = publicIdsFromCli.length ? publicIdsFromCli : await this.getTestsList(api)

    if (!testsToTrigger.length) {
      this.reporter.log('No test suites to run.\n')

      return 0
    }

    const {tests, overriddenTestsToTrigger, summary} = await getTestsToTrigger(api, testsToTrigger, this.reporter)
    const publicIdsToTrigger = tests.map(({public_id}) => public_id)

    let tunnel: Tunnel | undefined
    if (this.config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
      // Get the pre-signed URL to connect to the tunnel service
      const {url: presignedURL} = await api.getPresignedURL(publicIdsToTrigger)
      // Open a tunnel to Datadog
      try {
        tunnel = new Tunnel(presignedURL, publicIdsToTrigger, this.config.proxy, this.reporter)
        const tunnelInfo = await tunnel.start()
        overriddenTestsToTrigger.forEach((testToTrigger) => {
          testToTrigger.tunnel = tunnelInfo
        })
      } catch (e) {
        this.reporter.error(`\n${chalk.bgRed.bold(' ERROR on tunnel start ')}\n${e.stack}\n\n`)

        return 1
      }
    }
    const triggers = await runTests(api, overriddenTestsToTrigger)

    // All tests have been skipped or are missing.
    if (!tests.length) {
      this.reporter.log('No test to run.\n')

      return 0
    }

    if (!triggers.results) {
      throw new Error('No result to poll.')
    }

    try {
      // Poll the results.
      const results = await waitForResults(api, triggers.results, this.config.pollingTimeout, testsToTrigger, tunnel)

      // Sort tests to show success first then non blocking failures and finally blocking failures.
      tests.sort(this.sortTestsByOutcome(results))

      // Rendering the results.
      this.reporter.reportStart({startTime})
      const locationNames = triggers.locations.reduce((mapping, location) => {
        mapping[location.id] = location.display_name

        return mapping
      }, {} as LocationsMapping)

      let hasSucceeded = true // Determine if all the tests have succeeded
      for (const test of tests) {
        const testResults = results[test.public_id]

        const passed = hasTestSucceeded(testResults)
        if (passed) {
          summary.passed++
        } else {
          summary.failed++
          if (test.options.ci?.executionRule !== ExecutionRule.NON_BLOCKING) {
            hasSucceeded = false
          }
        }

        this.reporter.testEnd(test, testResults, this.getAppBaseURL(), locationNames)
      }

      this.reporter.runEnd(summary)

      if (hasSucceeded) {
        return 0
      } else {
        return 1
      }
    } catch (error) {
      this.reporter.error(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.stack}\n\n`)

      return 1
    } finally {
      // Stop the tunnel
      if (tunnel) {
        await tunnel.stop()
      }
    }
  }

  private getApiHelper() {
    if (!this.config.appKey || !this.config.apiKey) {
      if (!this.config.appKey) {
        this.reporter!.error(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
      }
      if (!this.config.apiKey) {
        this.reporter!.error(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      }
      throw new Error('API and/or Application keys are missing')
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      appKey: this.config.appKey!,
      baseIntakeUrl: this.getDatadogHost(true),
      baseUrl: this.getDatadogHost(),
      proxyOpts: this.config.proxy,
    })
  }

  private getAppBaseURL() {
    return `https://${this.config.subdomain}.${this.config.datadogSite}/`
  }

  private getDatadogHost(useIntake = false) {
    const apiPath = 'api/v1'
    let host = `https://api.${this.config.datadogSite}`
    const hostOverride = process.env.DD_API_HOST_OVERRIDE

    if (hostOverride) {
      host = hostOverride
    } else if (
      useIntake &&
      (this.config.datadogSite === 'datadoghq.com' || this.config.datadogSite === 'datad0g.com')
    ) {
      host = `https://intake.synthetics.${this.config.datadogSite}`
    }

    return `${host}/${apiPath}`
  }

  private async getTestsList(api: APIHelper) {
    if (this.config.testSearchQuery) {
      const testSearchResults = await api.searchTests(this.config.testSearchQuery)

      return testSearchResults.tests.map((test) => ({config: this.config.global, id: test.public_id}))
    }

    const suites = (await Promise.all(this.config.files.map((glob: string) => getSuites(glob, this.reporter!))))
      .reduce((acc, val) => acc.concat(val), [])
      .map((suite) => suite.tests)
      .filter((suiteTests) => !!suiteTests)

    const testsToTrigger = suites
      .reduce((acc, suiteTests) => acc.concat(suiteTests), [])
      .map((test) => ({
        config: {...this.config.global, ...test.config},
        id: test.id,
      }))

    return testsToTrigger
  }

  private async resolveConfig() {
    // Default < file < ENV < CLI

    // Override with file config variables
    const configPath = this.configPath ?? this.config.configPath
    this.config = await parseConfigFile(this.config, configPath)

    // Override with ENV variables
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        datadogSite: process.env.DATADOG_SITE,
        subdomain: process.env.DATADOG_SUBDOMAIN,
      })
    )

    // Override with CLI parameters
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: this.apiKey,
        appKey: this.appKey,
        configPath: this.configPath,
        files: this.files,
        publicIds: this.publicIds,
        testSearchQuery: this.testSearchQuery,
        tunnel: this.shouldOpenTunnel,
      })
    )
  }

  private sortTestsByOutcome(results: {[key: string]: PollResult[]}) {
    return (t1: Test, t2: Test) => {
      const success1 = hasTestSucceeded(results[t1.public_id])
      const success2 = hasTestSucceeded(results[t2.public_id])
      const isNonBlockingTest1 = t1.options.ci?.executionRule === ExecutionRule.NON_BLOCKING
      const isNonBlockingTest2 = t2.options.ci?.executionRule === ExecutionRule.NON_BLOCKING

      if (success1 === success2) {
        if (isNonBlockingTest1 === isNonBlockingTest2) {
          return 0
        }

        return isNonBlockingTest1 ? -1 : 1
      }

      return success1 ? -1 : 1
    }
  }
}

const removeUndefinedValues = <T extends {[key: string]: any}>(object: T): T => {
  const newObject = {...object}
  Object.keys(newObject).forEach((k) => newObject[k] === undefined && delete newObject[k])

  return newObject
}

RunTestCommand.addPath('synthetics', 'run-tests')
RunTestCommand.addOption('apiKey', Command.String('--apiKey'))
RunTestCommand.addOption('appKey', Command.String('--appKey'))
RunTestCommand.addOption('configPath', Command.String('--config'))
RunTestCommand.addOption('files', Command.Array('-f,--files'))
RunTestCommand.addOption('publicIds', Command.Array('-p,--public-id'))
RunTestCommand.addOption('shouldOpenTunnel', Command.Boolean('-t,--tunnel'))
RunTestCommand.addOption('testSearchQuery', Command.String('-s,--search'))
