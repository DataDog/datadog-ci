/* eslint-disable @typescript-eslint/member-ordering */
import {SyntheticsImportTestsCommand} from '@datadog/datadog-ci-base/commands/synthetics/import-tests'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {LogLevel, Logger} from '@datadog/datadog-ci-base/helpers/logger'
import {recursivelyRemoveUndefinedValues, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'
import deepExtend from 'deep-extend'

import {CiError} from '../errors'
import {importTests} from '../import-tests-lib'
import {ImportTestsCommandConfig, MainReporter} from '../interfaces'
import {RecursivePartial, getDefaultConfig} from '../utils/internal'

export class PluginCommand extends SyntheticsImportTestsCommand {
  protected reporter!: MainReporter
  protected config: ImportTestsCommandConfig = PluginCommand.getDefaultConfig()
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public static getDefaultConfig(): ImportTestsCommandConfig {
    return {
      ...getDefaultConfig(),
      files: [],
      publicIds: [],
      testSearchQuery: '',
    }
  }

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

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
        throw new CiError('INVALID_CONFIG', (error as Error).message)
      }
    }

    // Override with ENV variables
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromEnv()))

    // Override with CLI parameters
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromCli()))
  }

  public async execute() {
    await this.setup()

    try {
      await importTests(this.reporter, this.config)
    } catch (error) {
      this.logger.error(`Error: ${(error as Error).message}`)

      return 1
    }

    return 0
  }

  protected resolveConfigFromEnv(): RecursivePartial<ImportTestsCommandConfig> {
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
      testSearchQuery: process.env.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<ImportTestsCommandConfig> {
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
      testSearchQuery: this.testSearchQuery,
    }
  }
}
