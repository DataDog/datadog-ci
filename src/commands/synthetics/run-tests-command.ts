import {Command} from 'clipanion'
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
  // CLI arguments for JUnit reports
  public jUnitReport?: string
  public runName?: string

  // CLI arguments
  private apiKey?: string
  private appKey?: string
  private configPath?: string
  private datadogSite?: string
  private failOnCriticalErrors?: boolean
  private failOnMissingTests?: boolean
  private failOnTimeout?: boolean
  private files?: string[]
  private mobileApplicationVersionFilePath?: string
  private pollingTimeout?: string
  private publicIds?: string[]
  private reporter?: MainReporter
  private subdomain?: string
  private testSearchQuery?: string
  private tunnel?: boolean
  private variableStrings?: string[]

  private config = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) as RunTestsCommandConfig // Deep copy to avoid mutation during unit tests

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

    if (this.config.pollingTimeout !== DEFAULT_COMMAND_CONFIG.pollingTimeout) {
      this.reporter?.log(
        '[DEPRECATED] "pollingTimeout" should be set under the `global` key in the global configuration file or in a test file.\n'
      )
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
      this.reporter?.log('[DEPRECATED] "files" should be an array of string instead of a string.\n')
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

RunTestsCommand.addPath('synthetics', 'run-tests')
RunTestsCommand.addOption('apiKey', Command.String('--apiKey'))
RunTestsCommand.addOption('appKey', Command.String('--appKey'))
RunTestsCommand.addOption('configPath', Command.String('--config'))
RunTestsCommand.addOption('datadogSite', Command.String('--datadogSite'))
RunTestsCommand.addOption('failOnCriticalErrors', Command.Boolean('--failOnCriticalErrors'))
RunTestsCommand.addOption('failOnMissingTests', Command.Boolean('--failOnMissingTests'))
RunTestsCommand.addOption('failOnTimeout', Command.Boolean('--failOnTimeout'))
RunTestsCommand.addOption('files', Command.Array('-f,--files'))
RunTestsCommand.addOption('jUnitReport', Command.String('-j,--jUnitReport'))
RunTestsCommand.addOption(
  'mobileApplicationVersionFilePath',
  Command.String('--mobileApp,--mobileApplicationVersionFilePath')
)
RunTestsCommand.addOption('pollingTimeout', Command.String('--pollingTimeout'))
RunTestsCommand.addOption('publicIds', Command.Array('-p,--public-id'))
RunTestsCommand.addOption('runName', Command.String('-n,--runName'))
RunTestsCommand.addOption('subdomain', Command.String('--subdomain'))
RunTestsCommand.addOption('testSearchQuery', Command.String('-s,--search'))
RunTestsCommand.addOption('tunnel', Command.Boolean('-t,--tunnel'))
RunTestsCommand.addOption('variableStrings', Command.Array('-v,--variable'))
