import chalk from 'chalk'
import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {parseConfigFile} from '../../helpers/utils'
import {apiConstructor} from './api'
import {
  APIHelper,
  CommandConfig,
  ExecutionRule,
  MainReporter,
  PollResult,
  Test
} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {Tunnel} from './tunnel'
import {
  getReporter,
  getSuites,
  hasTestSucceeded,
} from './utils'
import { executeTests } from './run-test'

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
    return await executeTests(this.reporter, this.config, this.getApiHelper, this.getTestsList, this.sortTestsByOutcome, this.getAppBaseURL) 
  }

  private getApiHelper = () => {
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

  private getAppBaseURL = () => {
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

  private getTestsList = async (api: APIHelper) => {
    if (this.config.testSearchQuery) {
      const testSearchResults = await api.searchTests(this.config.testSearchQuery)

      return testSearchResults.tests.map((test) => ({config: this.config.global, id: test.public_id}))
    }

    const suites = (await Promise.all(this.config.files.map((glob: string) => getSuites(glob, this.reporter!))))
      .reduce((acc, val) => acc.concat(val), [])
      .map((suite) => suite.tests)
      .filter((suiteTests) => !!suiteTests)

    const configFromEnvironment = this.config.locations?.length ? {locations: this.config.locations} : {}
    const testsToTrigger = suites
      .reduce((acc, suiteTests) => acc.concat(suiteTests), [])
      .map((test) => ({
        config: {
          ...this.config.global,
          ...configFromEnvironment,
          ...test.config,
        },
        id: test.id,
      }))

    return testsToTrigger
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

  private sortTestsByOutcome = (results: {[key: string]: PollResult[]}) => {
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
