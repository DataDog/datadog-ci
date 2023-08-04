import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'

import {parseOptionalInteger, removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'
import {isValidDatadogSite} from '../../helpers/validation'

import {CiError} from './errors'
import {MainReporter, Reporter, Result, RunTestsCommandConfig, Summary} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {executeTests} from './run-tests-lib'
import {
  getExitReason,
  getOrgSettings,
  getReporter,
  parseVariablesFromCli,
  renderResults,
  reportCiError,
  toExitCode,
  reportExitLogs,
} from './utils'

export const MAX_TESTS_TO_TRIGGER = 100

export const DEFAULT_POLLING_TIMEOUT = 30 * 60 * 1000

export const DEFAULT_COMMAND_CONFIG: RunTestsCommandConfig = {
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

export class RunTestsCommand extends Command {
  public static paths = [['synthetics', 'run-tests']]

  public configPath = Option.String('--config')
  public jUnitReport = Option.String('-j,--jUnitReport')
  public runName = Option.String('-n,--runName')

  private apiKey = Option.String('--apiKey')
  private appKey = Option.String('--appKey')
  private datadogSite = Option.String('--datadogSite')
  private failOnCriticalErrors = Option.Boolean('--failOnCriticalErrors')
  private failOnMissingTests = Option.Boolean('--failOnMissingTests')
  private failOnTimeout = Option.Boolean('--failOnTimeout')
  private files = Option.Array('-f,--files')
  private mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath')
  private pollingTimeout = Option.String('--pollingTimeout')
  private publicIds = Option.Array('-p,--public-id')
  private subdomain = Option.String('--subdomain')
  private testSearchQuery = Option.String('-s,--search')
  private tunnel = Option.Boolean('-t,--tunnel')
  private variableStrings = Option.Array('-v,--variable')

  private reporter?: MainReporter
  private config: RunTestsCommandConfig = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests

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
        reportCiError(error, this.reporter)
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
      reportExitLogs(this.reporter, this.config, {error})

      return toExitCode(getExitReason(this.config, {error}))
    }

    const orgSettings = await getOrgSettings(this.reporter, this.config)

    renderResults({
      config: this.config,
      orgSettings,
      reporter: this.reporter,
      results,
      startTime,
      summary,
    })

    reportExitLogs(this.reporter, this.config, {results})

    return toExitCode(getExitReason(this.config, {results}))
  }

  private async resolveConfig() {
    // Defaults < file < ENV < CLI

    // Override with config file variables (e.g. datadog-ci.json)
    try {
      this.config = await resolveConfigFromFile(this.config, {
        configPath: this.configPath,
        defaultConfigPaths: [this.config.configPath],
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

    let pollingTimeoutCliArgument
    try {
      pollingTimeoutCliArgument = parseOptionalInteger(this.pollingTimeout)
    } catch (error) {
      throw new CiError('INVALID_CONFIG', `Invalid value for \`pollingTimeout\`: ${error.message}`)
    }

    // Override with Global CLI parameters
    this.config.global = deepExtend(
      this.config.global,
      removeUndefinedValues({
        mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
        variables: parseVariablesFromCli(this.variableStrings, (log) => this.reporter?.log(log)),
        pollingTimeout: pollingTimeoutCliArgument ?? this.config.global.pollingTimeout ?? this.config.pollingTimeout,
      })
    )

    if (typeof this.config.files === 'string') {
      this.reporter!.log('[DEPRECATED] "files" should be an array of string instead of a string.\n')
      this.config.files = [this.config.files]
    }

    if (!isValidDatadogSite(this.config.datadogSite)) {
      throw new CiError(
        'INVALID_CONFIG',
        `The \`datadogSite\` config property (${JSON.stringify(
          this.config.datadogSite
        )}) must match one of the sites supported by Datadog.\nFor more information, see "Site parameter" in our documentation: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site`
      )
    }
  }
}
