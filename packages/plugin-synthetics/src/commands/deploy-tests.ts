/* eslint-disable @typescript-eslint/member-ordering */
import {DeployTestsCommand} from '@datadog/datadog-ci-base/commands/synthetics/deploy-tests-command'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {LogLevel, Logger} from '@datadog/datadog-ci-base/helpers/logger'
import {recursivelyRemoveUndefinedValues, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'
import deepExtend from 'deep-extend'

import {BaseCommand, RecursivePartial} from '../base-command'
import {deployTests} from '../deploy-tests-lib'
import {CiError} from '../errors'
import {DeployTestsCommandConfig, MainReporter} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {getReporter} from '../utils/public'

export class PluginCommand extends DeployTestsCommand {
  protected reporter!: MainReporter
  protected config: DeployTestsCommandConfig = PluginCommand.getDefaultConfig()
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public static getDefaultConfig(): DeployTestsCommandConfig {
    return {
      ...BaseCommand.getDefaultConfig(),
      files: [],
      publicIds: [],
      subdomain: 'app',
      excludeFields: ['config'],
    }
  }

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    // Bootstrap reporter
    this.reporter = getReporter([new DefaultReporter(this)])

    // Load config
    await this.resolveConfig()
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

  public async execute() {
    // populate the config
    await this.setup()

    try {
      await deployTests(this.reporter, this.config)
    } catch (error) {
      this.logger.error(`Error: ${error.message}`)

      return 1
    }

    return 0
  }

  protected resolveConfigFromEnv(): RecursivePartial<DeployTestsCommandConfig> {
    return {
      // ...super.resolveConfigFromEnv(),
      // BASE COMMAND START
      apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
      appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
      // BASE COMMAND END
      files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
      publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
      subdomain: process.env.DATADOG_SUBDOMAIN,
      excludeFields: process.env.DATADOG_SYNTHETICS_EXCLUDE_FIELDS?.split(';'),
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<DeployTestsCommandConfig> {
    return {
      // ...super.resolveConfigFromCli(),
      // BASE COMMAND START
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
      // BASE COMMAND END
      files: this.files,
      publicIds: this.publicIds,
      subdomain: this.subdomain,
      excludeFields: this.excludeFields,
    }
  }
}
