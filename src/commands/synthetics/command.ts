import chalk from 'chalk'
import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'
import {CiError, CriticalError} from './errors'
import {CommandConfig, MainReporter, Reporter, Result, Summary} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {executeTests} from './run-test'
import {getReporter, parseVariablesFromCli, renderResults, validateDatadogSite} from './utils'

export const MAX_TESTS_TO_TRIGGER = 100

export const DEFAULT_POLLING_TIMEOUT = 2 * 60 * 1000

export const DEFAULT_COMMAND_CONFIG: CommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  locations: [],
  pollingTimeout: DEFAULT_POLLING_TIMEOUT,
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
  tunnel: false,
  variableStrings: [],
}

export class RunTestCommand extends Command {
  public configPath?: string
  public jUnitReport?: string
  public runName?: string
  private apiKey?: string
  private appKey?: string
  private config: CommandConfig = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests
  private datadogSite?: string
  private failOnCriticalErrors?: boolean
  private failOnMissingTests?: boolean
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

    try {
      await this.resolveConfig()
    } catch (error) {
      if (error instanceof CiError) {
        this.reportCiError(error, this.reporter)
      }

      return 1
    }

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

        if (this.config.failOnMissingTests && error.code === 'MISSING_TESTS') {
          return 1
        }

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

    return renderResults({config: this.config, reporter: this.reporter, results, startTime, summary})
  }

  private reportCiError(error: CiError, reporter: MainReporter) {
    switch (error.code) {
      case 'NO_TESTS_TO_RUN':
        reporter.log('No test to run.\n')
        break
      case 'MISSING_TESTS':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: some tests are missing ')}\n${error.message}\n\n`)
        break

      // Critical command errors
      case 'AUTHORIZATION_ERROR':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: authorization error ')}\n${error.message}\n\n`)
        reporter.log('Credentials refused, make sure `apiKey`, `appKey` and `datadogSite` are correct.\n')
        break
      case 'INVALID_CONFIG':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: invalid config ')}\n${error.message}\n\n`)
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
      case 'TOO_MANY_TESTS_TO_TRIGGER':
        reporter.error(`\n${chalk.bgRed.bold(' ERROR: too many tests to trigger ')}\n${error.message}\n\n`)
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
        break

      default:
        reporter.error(`\n${chalk.bgRed.bold(' ERROR ')}\n${error.message}\n\n`)
    }
  }

  private async resolveConfig() {
    // Default < file < ENV < CLI

    // Override with file config variables
    try {
      this.config = await resolveConfigFromFile(this.config, {
        configPath: this.configPath,
        defaultConfigPath: this.config.configPath,
      })
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
        failOnMissingTests: this.failOnMissingTests,
        failOnTimeout: this.failOnTimeout,
        files: this.files,
        publicIds: this.publicIds,
        subdomain: this.subdomain,
        testSearchQuery: this.testSearchQuery,
        tunnel: this.tunnel,
      })
    )

    // Pass root polling timeout to global override to get it applied to all tests if not defined individually
    this.config.global.pollingTimeout = this.config.global.pollingTimeout ?? this.config.pollingTimeout

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

    validateDatadogSite(this.config.datadogSite)
  }
}

RunTestCommand.addPath('synthetics', 'run-tests')
RunTestCommand.addOption('apiKey', Command.String('--apiKey'))
RunTestCommand.addOption('appKey', Command.String('--appKey'))
RunTestCommand.addOption('configPath', Command.String('--config'))
RunTestCommand.addOption('datadogSite', Command.String('--datadogSite'))
RunTestCommand.addOption('failOnCriticalErrors', Command.Boolean('--failOnCriticalErrors'))
RunTestCommand.addOption('failOnMissingTests', Command.Boolean('--failOnMissingTests'))
RunTestCommand.addOption('failOnTimeout', Command.Boolean('--failOnTimeout'))
RunTestCommand.addOption('files', Command.Array('-f,--files'))
RunTestCommand.addOption('jUnitReport', Command.String('-j,--jUnitReport'))
RunTestCommand.addOption('publicIds', Command.Array('-p,--public-id'))
RunTestCommand.addOption('runName', Command.String('-n,--runName'))
RunTestCommand.addOption('subdomain', Command.Boolean('--subdomain'))
RunTestCommand.addOption('testSearchQuery', Command.String('-s,--search'))
RunTestCommand.addOption('tunnel', Command.Boolean('-t,--tunnel'))
RunTestCommand.addOption('variableStrings', Command.Array('-v,--variable'))
