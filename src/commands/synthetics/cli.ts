import chalk from 'chalk'
import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {parseConfigFile} from '../../helpers/utils'
import {CiError, CriticalError} from './errors'
import {CommandConfig, ExecutionRule, LocationsMapping, MainReporter, PollResult, Test} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {executeTests} from './run-test'
import {getReporter, hasTestSucceeded, isCriticalError} from './utils'

export const DEFAULT_COMMAND_CONFIG: CommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  locations: [],
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
  private datadogSite?: string
  private failOnCriticalErrors?: boolean
  private failOnTimeout?: boolean
  private files?: string[]
  private publicIds?: string[]
  private reporter?: MainReporter
  private subdomain?: string
  private testSearchQuery?: string
  private tunnel?: boolean

  public async execute() {
    const reporters = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)
    await this.resolveConfig()
    const startTime = Date.now()
    if (this.config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
    }
    try {
      const {results, summary, tests, triggers} = await executeTests(this.reporter, this.config)
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
        if (!this.config.failOnTimeout) {
          if (!summary.timedOut) {
            summary.timedOut = 0
          }

          const hasTimeout = testResults.some((pollResult) => pollResult.result.error === 'Timeout')
          if (hasTimeout) {
            summary.timedOut++
          }
        }

        if (!this.config.failOnCriticalErrors) {
          if (!summary.criticalErrors) {
            summary.criticalErrors = 0
          }
          const hasCriticalErrors = testResults.some((pollResult) => isCriticalError(pollResult.result))
          if (hasCriticalErrors) {
            summary.criticalErrors++
          }
        }

        const passed = hasTestSucceeded(testResults, this.config.failOnCriticalErrors, this.config.failOnTimeout)
        if (passed) {
          summary.passed++
        } else {
          summary.failed++
          if (test.options.ci?.executionRule !== ExecutionRule.NON_BLOCKING) {
            hasSucceeded = false
          }
        }

        this.reporter.testEnd(
          test,
          testResults,
          this.getAppBaseURL(),
          locationNames,
          this.config.failOnCriticalErrors,
          this.config.failOnTimeout
        )
      }

      this.reporter.runEnd(summary)

      return hasSucceeded ? 0 : 1
    } catch (error) {
      if (error instanceof CiError) {
        switch (error.code) {
          case 'NO_TESTS_TO_RUN':
            this.reporter.log('No test to run.\n')
            break
          case 'MISSING_APP_KEY':
            this.reporter.error(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
            break
          case 'MISSING_API_KEY':
            this.reporter.error(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
            break
          case 'POLL_RESULTS_FAILED':
            this.reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${error.message}\n\n`)
            break
          case 'TUNNEL_START_FAILED':
            this.reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to start tunnel')}\n${error.message}\n\n`)
            break
          case 'TRIGGER_TESTS_FAILED':
            this.reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to trigger tests')}\n${error.message}\n\n`)
            break
          case 'UNAVAILABLE_TEST_CONF':
            this.reporter.error(
              `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations with search query ')}\n${
                error.message
              }\n\n`
            )
            break
          case 'UNAVAILABLE_TUNNEL_CONF':
            this.reporter.error(
              `\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration')}\n${error.message}\n\n`
            )
        }
        if (error instanceof CriticalError && this.config.failOnCriticalErrors) {
          return 1
        }
      }

      return 0
    }
  }

  private getAppBaseURL() {
    return `https://${this.config.subdomain}.${this.config.datadogSite}/`
  }

  private async resolveConfig() {
    // Default < file < ENV < CLI

    // Override with file config variables
    try {
      this.config = await parseConfigFile(this.config, this.configPath ?? this.config.configPath)
    } catch (error) {
      if (this.configPath) {
        throw error
      }
    }

    // Override with ENV variables
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        datadogSite: process.env.DATADOG_SITE,
        locations: process.env.DATADOG_SYNTHETICS_LOCATIONS?.split(';'),
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
        datadogSite: this.datadogSite,
        failOnCriticalErrors: this.failOnCriticalErrors,
        failOnTimeout: this.failOnTimeout,
        files: this.files,
        publicIds: this.publicIds,
        subdomain: this.subdomain,
        testSearchQuery: this.testSearchQuery,
        tunnel: this.tunnel,
      })
    )

    if (typeof this.config.files === 'string') {
      this.reporter!.log('[DEPRECATED] "files" should be an array of string instead of a string.\n')
      this.config.files = [this.config.files]
    }
  }

  private sortTestsByOutcome(results: {[key: string]: PollResult[]}) {
    return (t1: Test, t2: Test) => {
      const success1 = hasTestSucceeded(
        results[t1.public_id],
        this.config.failOnCriticalErrors,
        this.config.failOnTimeout
      )
      const success2 = hasTestSucceeded(
        results[t2.public_id],
        this.config.failOnCriticalErrors,
        this.config.failOnTimeout
      )
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

export const removeUndefinedValues = <T extends {[key: string]: any}>(object: T): T => {
  const newObject = {...object}
  Object.keys(newObject).forEach((k) => newObject[k] === undefined && delete newObject[k])

  return newObject
}

RunTestCommand.addPath('synthetics', 'run-tests')
RunTestCommand.addOption('apiKey', Command.String('--apiKey'))
RunTestCommand.addOption('appKey', Command.String('--appKey'))
RunTestCommand.addOption('failOnCriticalErrors', Command.Boolean('--failOnCriticalErrors'))
RunTestCommand.addOption('configPath', Command.String('--config'))
RunTestCommand.addOption('datadogSite', Command.String('--datadogSite'))
RunTestCommand.addOption('files', Command.Array('-f,--files'))
RunTestCommand.addOption('failOnTimeout', Command.Boolean('--failOnTimeout'))
RunTestCommand.addOption('publicIds', Command.Array('-p,--public-id'))
RunTestCommand.addOption('testSearchQuery', Command.String('-s,--search'))
RunTestCommand.addOption('subdomain', Command.Boolean('--subdomain'))
RunTestCommand.addOption('tunnel', Command.Boolean('-t,--tunnel'))
