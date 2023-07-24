import {BaseContext, Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {resolveConfigFromFile} from '../../helpers/config'
import {parseOptionalInteger, removeUndefinedValues} from '../../helpers/utils'
import {isValidDatadogSite} from '../../helpers/validation'

import {CiError} from './errors'
import {MainReporter, Reporter, Result, RunTestsConfig, Summary} from './interfaces'
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
  structuredClone,
} from './utils'

export const MAX_TESTS_TO_TRIGGER = 100

export const DEFAULT_POLLING_TIMEOUT = 30 * 60 * 1000

export const DEFAULT_CONFIG_PATH = 'datadog-ci.json'

const identity = (v: string | boolean | string[]) => v

// The config expected at the root of the RunTestsCommand, which slightly differs from
// the RunTestsConfig, the config expected by the actual executeTests function.
export type RunTestsCommandConfig = Omit<RunTestsConfig, 'pollingTimeout' | 'proxy'> & {
  configPath: string
  pollingTimeout: string
  proxy: string
}

export const DEFAULT_CONFIG: RunTestsConfig = {
  apiKey: '',
  appKey: '',
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

export class RunTestsCommand extends Command implements Partial<RunTestsCommandConfig> {
  // RunTestsConfig fields populated by clipanion from command line arguments
  public apiKey?: string
  public appKey?: string
  public datadogSite?: string
  public failOnCriticalErrors?: boolean
  public failOnMissingTests?: boolean
  public failOnTimeout?: boolean
  public files?: string[]
  public jUnitReport?: string
  public locations?: string[]
  public mobileApplicationVersionFilePath?: string
  public pollingTimeout?: string
  public proxy?: string
  public publicIds?: string[]
  public runName?: string
  public subdomain?: string
  public testSearchQuery?: string
  public tunnel?: boolean
  public variableStrings?: string[]

  // Command properties, actually required by the cli but not part of RunTestsConfig
  public configPath?: string
  private reporter?: MainReporter

  public async execute() {
    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)

    let config
    try {
      config = mergeConfigs(
        structuredClone(DEFAULT_CONFIG), // Deep copy to avoid mutation during unit tests
        await resolveConfigFromFile({configPath: this.configPath, defaultConfigPaths: [DEFAULT_CONFIG_PATH]}),
        resolveConfigFromEnv(runTestsCommandInputsConfig),
        this.resolveConfigFromCommandLine()
      )
    } catch (error) {
      console.log(error, this.configPath)
      if (error instanceof CiError) {
        reportCiError(error, this.reporter)
      }

      return 1
    }

    console.log(config)

    if (config.jUnitReport) {
      reporters.push(new JUnitReporter(this))
    }

    const startTime = Date.now()
    if (config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
    }

    return

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

  private resolveConfigFromCommandLine = () => {
    const commandLineConfig: Partial<RunTestsConfig> = {}

    let input: keyof typeof runTestsCommandInputsConfig
    for (input in runTestsCommandInputsConfig) {
      if (
        input !== 'global' &&
        input !== 'configPath' &&
        input !== 'proxy' &&
        {}.hasOwnProperty.call(runTestsCommandInputsConfig, input)
      ) {
        const s = this[input]
        if (s !== undefined) {
          const parser = runTestsCommandInputsConfig[input].parser ?? identity
          commandLineConfig[input] = parser(s)
        }
      }
    }

    return commandLineConfig
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

const mergeConfigs = (
  defaultConfig: RunTestsConfig,
  ...configs: (Partial<RunTestsConfig> | undefined)[]
): RunTestsConfig => {
  const config = defaultConfig

  for (const overrideConfig of configs) {
    deepExtend(config, removeUndefinedValues(overrideConfig ?? {}))
  }

  return config
}

const resolveConfigFromEnv = (inputs: typeof runTestsCommandInputsConfig): Partial<RunTestsConfig> => {
  const config: Partial<RunTestsConfig> = {}
  let input: keyof typeof inputs
  for (input in inputs) {
    if (input !== 'global' && input !== 'configPath' && {}.hasOwnProperty.call(inputs, input)) {
      const parser = runTestsCommandInputsConfig[input].parser ?? identity
      config[input] = parser(process.env[inputs[input].env])
    }
  }

  return config
}

type CommandLineInputs = Exclude<keyof RunTestsConfig, 'global'> | 'configPath'
type EnvInputs = Exclude<keyof RunTestsConfig, 'global'>
type ConfigFileInputs = keyof RunTestsConfig

const runTestsCommandInputsConfig: Record<
  CommandLineInputs,
  {
    commandLineFlag: (prototype: Command<BaseContext>, propertyName: string) => void
    parser?: (value: any) => any // TODO fix this
  }
> &
  Record<
    EnvInputs,
    {
      env: string
    }
  > &
  Record<
    ConfigFileInputs,
    {
      // configFileField: string
    }
  > = {
  apiKey: {
    commandLineFlag: Command.String('--apiKey'),
    env: 'DATADOG_API_KEY',
  },
  appKey: {
    commandLineFlag: Command.String('--appKey'),
    env: 'DATADOG_APP_KEY',
  },
  configPath: {
    commandLineFlag: Command.String('--config'),
  },
  datadogSite: {
    commandLineFlag: Command.String('--datadogSite'),
    env: 'DATADOG_SITE',
  },
  failOnCriticalErrors: {
    commandLineFlag: Command.Boolean('--failOnCriticalErrors'),
    env: 'DATADOG_SYNTHETICS_CI_FAIL_ON_CRITICAL_ERRORS',
  },
  failOnMissingTests: {
    commandLineFlag: Command.Boolean('--failOnMissingTests'),
    env: 'DATADOG_SYNTHETICS_CI_FAIL_ON_MISSING_TESTS',
  },
  failOnTimeout: {
    commandLineFlag: Command.Boolean('--failOnTimeout'),
    env: 'DATADOG_SYNTHETICS_CI_FAIL_ON_TIMEOUT',
  },
  files: {
    commandLineFlag: Command.Array('-f,--files'),
    env: 'DATADOG_SYNTHETICS_CI_FILES',
  },
  global: {},
  locations: {
    commandLineFlag: Command.Array('-l,--location'),
    env: 'DATADOG_SYNTHETICS_CI_LOCATIONS',
  },
  jUnitReport: {
    commandLineFlag: Command.String('-j,--jUnitReport'),
    env: 'DATADOG_SYNTHETICS_CI_J_UNIT_REPORT',
  },
  mobileApplicationVersionFilePath: {
    commandLineFlag: Command.String('--mobileApp,--mobileApplicationVersionFilePath'),
    env: 'DATADOG_SYNTHETICS_CI_MOBILE_APPLICATION_VERSION_FILE_PATH',
  },
  pollingTimeout: {
    commandLineFlag: Command.String('--pollingTimeout'),
    parser: (pollingTimeout: string | undefined) => {
      try {
        return parseOptionalInteger(pollingTimeout)
      } catch (error) {
        throw new CiError('INVALID_CONFIG', `Invalid value for \`pollingTimeout\`: ${error.message}`)
      }
    },
    env: 'DATADOG_SYNTHETICS_CI_POLLING_TIMEOUT',
  },
  publicIds: {
    commandLineFlag: Command.Array('-p,--public-id'),
    env: 'DATADOG_SYNTHETICS_CI_PUBLIC_IDS',
  },
  proxy: {
    commandLineFlag: Command.String('--proxy'),
    env: 'DATADOG_SYNTHETICS_CI_PROXY',
  },
  runName: {
    commandLineFlag: Command.String('-n,--runName'),
    env: 'DATADOG_SYNTHETICS_CI_RUN_NAME',
  },
  subdomain: {
    commandLineFlag: Command.String('--subdomain'),
    env: 'DATADOG_SYNTHETICS_CI_SUBDOMAIN',
  },
  testSearchQuery: {
    commandLineFlag: Command.String('-s,--search'),
    env: 'DATADOG_SYNTHETICS_CI_TEST_SEARCH_QUERY',
  },
  tunnel: {
    commandLineFlag: Command.Boolean('-t,--tunnel'),
    env: 'DATADOG_SYNTHETICS_CI_TUNNEL',
  },
  variableStrings: {
    commandLineFlag: Command.Array('-v,--variable'),
    env: 'DATADOG_SYNTHETICS_CI_VARIABLE_STRINGS',
  },
} as const

RunTestsCommand.addPath('synthetics', 'run-tests')

// Register all the command inputs as command line arguments
// (in a new block to prevent polluting global scope with let input)
{
  let input: keyof typeof runTestsCommandInputsConfig
  for (input in runTestsCommandInputsConfig) {
    if (input !== 'global' && input !== 'proxy' && {}.hasOwnProperty.call(runTestsCommandInputsConfig, input)) {
      RunTestsCommand.addOption(input, runTestsCommandInputsConfig[input].commandLineFlag)
    }
  }
}
