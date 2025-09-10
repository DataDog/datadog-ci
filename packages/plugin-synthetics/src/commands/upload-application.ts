/* eslint-disable @typescript-eslint/member-ordering */
import {UploadApplicationCommand} from '@datadog/datadog-ci-base/commands/synthetics/upload-application-command'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {LogLevel, Logger} from '@datadog/datadog-ci-base/helpers/logger'
import {recursivelyRemoveUndefinedValues, resolveConfigFromFile} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import deepExtend from 'deep-extend'

import {EndpointError} from '../api'
import {CiError} from '../errors'
import {UploadApplicationCommandConfig} from '../interfaces'
import {uploadMobileApplicationVersion} from '../mobile'
import {AppUploadReporter} from '../reporters/mobile/app-upload'
import {RecursivePartial, getDefaultConfig} from '../utils/internal'

export class PluginCommand extends UploadApplicationCommand {
  protected config: UploadApplicationCommandConfig = PluginCommand.getDefaultConfig()
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public static getDefaultConfig(): UploadApplicationCommandConfig {
    return {
      ...getDefaultConfig(),
      mobileApplicationVersionFilePath: '',
      mobileApplicationId: '',
      versionName: '',
      latest: false,
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

    const appUploadReporter = new AppUploadReporter(this.context)
    try {
      const result = await uploadMobileApplicationVersion(this.config, appUploadReporter)
      const versionUuid = result.valid_app_result?.app_version_uuid

      if (!versionUuid) {
        this.logger.error('The upload was successful, but the version ID is missing.')

        return 1
      }

      this.logger.info(
        `\nThe new version has version ID: ${chalk.green(
          versionUuid
        )}\nPass it when triggering Synthetic tests to run tests against that version.`
      )
    } catch (error) {
      if (error instanceof CiError) {
        this.logger.error(`A CI error occurred: [${error.code}] ${error.message}`)
      } else if (error instanceof EndpointError) {
        this.logger.error(`A backend error occurred: ${error.message} (${error.status})`)
      } else {
        const e = error as Error
        this.logger.error(`An unexpected error occurred: ${e.stack || e.message}`)
      }

      return 1
    }

    return 0
  }

  protected resolveConfigFromEnv(): RecursivePartial<UploadApplicationCommandConfig> {
    return {
      // ...super.resolveConfigFromEnv(),
      // BASE COMMAND START
      apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
      appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
      // BASE COMMAND END
      mobileApplicationId: process.env.DATADOG_SYNTHETICS_MOBILE_APPLICATION_ID,
      versionName: process.env.DATADOG_SYNTHETICS_VERSION_NAME,
      latest: toBoolean(process.env.DATADOG_SYNTHETICS_LATEST),
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<UploadApplicationCommandConfig> {
    return {
      // ...super.resolveConfigFromCli(),
      // BASE COMMAND START
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
      // BASE COMMAND END
      mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
      mobileApplicationId: this.mobileApplicationId,
      versionName: this.versionName,
      latest: this.latest,
    }
  }
}
