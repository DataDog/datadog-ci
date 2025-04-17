import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {Logger, LogLevel} from '../../helpers/logger'
import {recursivelyRemoveUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'

import {CiError} from './errors'
import {DatadogCIConfig, MainReporter, Reporter} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {getReporter} from './utils/public'

export type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)

export abstract class BaseCommand extends Command {
  protected config: DatadogCIConfig = BaseCommand.getDefaultConfig()
  protected reporter!: MainReporter

  protected configPath = Option.String('--config', {
    description: `Pass a path to a ${$1('global configuration file')}.`,
  })
  protected apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  protected appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  protected datadogSite = Option.String('--datadogSite', {
    description: 'The Datadog instance to which request is sent.',
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

  // This method should be overloaded by the child class, and called as super.<method> in the child class, to add more config.
  public static getDefaultConfig(): DatadogCIConfig {
    return {
      apiKey: '',
      appKey: '',
      configPath: 'datadog-ci.json',
      datadogSite: 'datadoghq.com',
      proxy: {protocol: 'http'},
    }
  }

  // This method should be overloaded by the child class, and called as super.<method> in the child class, to add more config.
  protected resolveConfigFromEnv(): RecursivePartial<DatadogCIConfig> {
    return {
      apiKey: process.env.DATADOG_API_KEY,
      appKey: process.env.DATADOG_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE,
    }
  }

  // This method should be overloaded by the child class, and called as super.<method> in the child class, to add more config.
  protected resolveConfigFromCli(): RecursivePartial<DatadogCIConfig> {
    return {
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
    }
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

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    const reporters: Reporter[] = [new DefaultReporter(this), ...this.getReporters()]
    this.reporter = getReporter(reporters)

    await this.resolveConfig()
    this.normalizeConfig()
    this.validateConfig()
  }

  protected normalizeConfig() {
    // Normalize the config here
  }

  protected validateConfig() {
    // Validate the config here
  }

  protected getReporters(): Reporter[] {
    return []
  }
}
