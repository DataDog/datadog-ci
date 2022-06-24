import chalk from 'chalk'
import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {parseConfigFile, removeUndefinedValues} from '../../helpers/utils'
import {CiError, CriticalError} from './errors'
import {CommandConfig, MainReporter, Reporter, Result, Summary} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {executeTests} from './run-test'
import {getReporter, getResultOutcome, parseVariablesFromCli, ResultOutcome} from './utils'

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
  variableStrings: [],
}

export class RunTestCommand extends Command {
  public jUnitReport?: string
  public runName?: string
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
  private variableStrings?: string[]

  public async execute() {
    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)

    if (this.jUnitReport) {
      reporters.push(new JUnitReporter(this))
    }
    await this.resolveConfig()
    const startTime = Date.now()
    if (this.config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
    }

    let results: Result[]
    let summary: Summary

    try {
      ;({results, summary} = await executeTests(this.reporter, this.config))
    } catch (error) {
      if (error instanceof CiError) {
        this.reportCiError(error, this.reporter)

        if (error instanceof CriticalError) {
          if (this.config.failOnCriticalErrors) {
            return 1
          } else {
            this.reporter.error(
              chalk.yellow(
                'Because `failOnCriticalErrors` is not set or disabled, the command will exit with an error code 0. ' +
                  'Use `failOnCriticalErrors: true` to exit with an error code 1.\n'
              )
            )
          }
        }
      }

      return 0
    }

    return this.renderResults(results, summary, startTime)
  }

  private getAppBaseURL() {
    return `https://${this.config.subdomain}.${this.config.datadogSite}/`
  }

  private renderResults(results: Result[], summary: Summary, startTime: number) {
    // Rendering the results.
    this.reporter?.reportStart({startTime})

    if (!this.config.failOnTimeout) {
      if (!summary.timedOut) {
        summary.timedOut = 0
      }
    }

    if (!this.config.failOnCriticalErrors) {
      if (!summary.criticalErrors) {
        summary.criticalErrors = 0
      }
    }

    let hasSucceeded = true // Determine if all the tests have succeeded

    const sortedResults = results.sort(this.sortResultsByOutcome())

    for (const result of sortedResults) {
      if (!this.config.failOnTimeout && result.timedOut) {
        summary.timedOut++
      }

      if (result.result.unhealthy && !this.failOnCriticalErrors) {
        summary.criticalErrors++
      }

      const resultOutcome = getResultOutcome(result)

      if ([ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)) {
        summary.passed++
      } else if (resultOutcome === ResultOutcome.FailedNonBlocking) {
        summary.failedNonBlocking++
      } else {
        summary.failed++
        hasSucceeded = false
      }

      this.reporter?.resultEnd(result, this.getAppBaseURL())
    }

    this.reporter?.runEnd(summary)

    return hasSucceeded ? 0 : 1
  }

  private reportCiError(error: CiError, reporter: MainReporter) {
    switch (error.code) {
      case 'NO_TESTS_TO_RUN':
        reporter.log('No test to run.\n')
        break

      // Critical command errors
      case 'AUTHORIZATION_ERROR':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: authorization error ')}\n${error.message}\n\n`)
        reporter.log('Credentials refused, make sure `apiKey`, `appKey` and `datadogSite` are correct.\n')
        break
      case 'MISSING_APP_KEY':
        reporter.error(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
        break
      case 'MISSING_API_KEY':
        reporter.error(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
        break
      case 'POLL_RESULTS_FAILED':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to poll test results ')}\n${error.message}\n\n`)
        break
      case 'TUNNEL_START_FAILED':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to start tunnel ')}\n${error.message}\n\n`)
        break
      case 'TRIGGER_TESTS_FAILED':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to trigger tests ')}\n${error.message}\n\n`)
        break
      case 'UNAVAILABLE_TEST_CONFIG':
        reporter.error(
          `\n${chalk.bgRed.bold(' ERROR: unable to obtain test configurations with search query ')}\n${
            error.message
          }\n\n`
        )
        break
      case 'UNAVAILABLE_TUNNEL_CONFIG':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: unable to get tunnel configuration ')}\n${error.message}\n\n`)
    }
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

    // Override with Global CLI parameters
    this.config.global = deepExtend(
      this.config.global,
      removeUndefinedValues({
        variables: parseVariablesFromCli(this.variableStrings, (log) => this.reporter?.log(log)),
      })
    )

    if (typeof this.config.files === 'string') {
      this.reporter!.log('[DEPRECATED] "files" should be an array of string instead of a string.\n')
      this.config.files = [this.config.files]
    }
  }

  /**
   * Sort results with the following rules:
   * - Passed results come first
   * - Then non-blocking failed results
   * - And finally failed results
   */
  private sortResultsByOutcome() {
    const outcomeWeight = {
      [ResultOutcome.PassedNonBlocking]: 1,
      [ResultOutcome.Passed]: 2,
      [ResultOutcome.FailedNonBlocking]: 3,
      [ResultOutcome.Failed]: 4,
    }

    return (r1: Result, r2: Result) => outcomeWeight[getResultOutcome(r1)] - outcomeWeight[getResultOutcome(r2)]
  }
}

RunTestCommand.addPath('synthetics', 'run-tests')
RunTestCommand.addOption('apiKey', Command.String('--apiKey'))
RunTestCommand.addOption('appKey', Command.String('--appKey'))
RunTestCommand.addOption('configPath', Command.String('--config'))
RunTestCommand.addOption('datadogSite', Command.String('--datadogSite'))
RunTestCommand.addOption('failOnCriticalErrors', Command.Boolean('--failOnCriticalErrors'))
RunTestCommand.addOption('failOnTimeout', Command.Boolean('--failOnTimeout'))
RunTestCommand.addOption('files', Command.Array('-f,--files'))
RunTestCommand.addOption('jUnitReport', Command.String('-j,--jUnitReport'))
RunTestCommand.addOption('publicIds', Command.Array('-p,--public-id'))
RunTestCommand.addOption('runName', Command.String('-n,--runName'))
RunTestCommand.addOption('subdomain', Command.Boolean('--subdomain'))
RunTestCommand.addOption('testSearchQuery', Command.String('-s,--search'))
RunTestCommand.addOption('tunnel', Command.Boolean('-t,--tunnel'))
RunTestCommand.addOption('variableStrings', Command.Array('-v,--variable'))
