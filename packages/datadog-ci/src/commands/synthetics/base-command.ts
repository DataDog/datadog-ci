import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {
  makeTerminalLink,
  recursivelyRemoveUndefinedValues,
  resolveConfigFromFile,
} from '@datadog/datadog-ci-base/helpers/utils'
import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'

import {CiError} from './errors'
import {DatadogCIConfig, MainReporter, Reporter} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {getReporter} from './utils/public'

export type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>
}

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/account_management/api-app-keys`)
const $2 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#global-configuration-file`
)
const $3 = makeTerminalLink(`${datadogDocsBaseUrl}/getting_started/site/#access-the-datadog-site`)

export abstract class BaseCommand extends Command {
  protected config: DatadogCIConfig = BaseCommand.getDefaultConfig()
  protected reporter!: MainReporter

  protected apiKey = Option.String('--apiKey', {
    description: `Your Datadog API key. This key is ${$1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected appKey = Option.String('--appKey', {
    description: `Your Datadog application key. This key is ${$1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected configPath = Option.String('--config', {
    description: `The path to the ${$2`global configuration file`} that configures datadog-ci.`,
  })
  protected datadogSite = Option.String('--datadogSite', {
    description: `Your Datadog site. Possible values are listed ${$3`in this table`}.`,
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  /** This method can be overloaded by the child class. Use `super.getDefaultConfig()` to add more config. */
  public static getDefaultConfig(): DatadogCIConfig {
    return {
      apiKey: '',
      appKey: '',
      configPath: 'datadog-ci.json',
      datadogSite: 'datadoghq.com',
      proxy: {protocol: 'http'},
    }
  }

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    // Bootstrap reporter
    this.reporter = getReporter([new DefaultReporter(this)])

    // Load config
    await this.resolveConfig()
    this.normalizeConfig()
    this.validateConfig()

    // Update reporter
    this.reporter = getReporter([new DefaultReporter(this), ...this.getReporters()])
  }

  protected async resolveConfig() {
    // Defaults < file < ENV < CLI

    // Override with config file variables (e.g. datadog-ci.json)
    try {
      // Override Config Path with ENV variables
      const overrideConfigPath = this.configPath ?? process.env.DATADOG_SYNTHETICS_CONFIG_PATH ?? 'datadog-ci.json'
      this.config = await resolveConfigFromFile(this.config, {
        configPath: overrideConfigPath,
        defaultConfigPaths: [this.config.configPath],
      })
    } catch (error) {
      if (this.configPath) {
        throw new CiError('INVALID_CONFIG', error.message)
      }
    }

    // Override with ENV variables
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromEnv()))

    // Override with CLI parameters
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromCli()))
  }

  /** This method can be overloaded by the child class. Use `super.resolveConfigFromEnv()` to add more config. */
  protected resolveConfigFromEnv(): RecursivePartial<DatadogCIConfig> {
    return {
      apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
      appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
    }
  }

  /** This method can be overloaded by the child class. Use `super.resolveConfigFromCli()` to add more config. */
  protected resolveConfigFromCli(): RecursivePartial<DatadogCIConfig> {
    return {
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
    }
  }

  /** This method can be overloaded by the child class. */
  protected normalizeConfig(): void {}

  /** This method can be overloaded by the child class. */
  protected validateConfig(): void {}

  /** This method can be overloaded by the child class. */
  protected getReporters(): Reporter[] {
    return []
  }
}
