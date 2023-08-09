import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'

import {LogLevel, Logger} from '../../helpers/logger'
import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'

import {EndpointError} from './api'
import {CiError, CriticalError} from './errors'
import {UploadApplicationCommandConfig} from './interfaces'
import {uploadMobileApplicationVersion} from './mobile'

export const DEFAULT_UPLOAD_COMMAND_CONFIG: UploadApplicationCommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  proxy: {protocol: 'http'},
  mobileApplicationVersionFilePath: '',
  mobileApplicationId: '',
  versionName: '',
  latest: false,
}

export class UploadApplicationCommand extends Command {
  public static paths = [['synthetics', 'upload-application']]

  private apiKey = Option.String('--apiKey')
  private appKey = Option.String('--appKey')
  private configPath = Option.String('--config')
  private datadogSite = Option.String('--datadogSite')
  private mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath')
  private mobileApplicationId = Option.String('--mobileApplicationId')
  private versionName = Option.String('--versionName')
  private latest = Option.Boolean('--latest')

  private config: UploadApplicationCommandConfig = JSON.parse(JSON.stringify(DEFAULT_UPLOAD_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public async execute() {
    try {
      await this.resolveConfig()
    } catch (error) {
      this.logger.error(`Error: invalid config`)

      return 1
    }

    try {
      const version = await uploadMobileApplicationVersion(this.config)
      this.logger.info(`Created new version ${version.version_name}, with version ID: ${version.id}`)
    } catch (error) {
      if (error instanceof CiError || error instanceof EndpointError || error instanceof CriticalError) {
        this.logger.error(`Error: ${error.message}`)
      }

      return 1
    }
  }

  private async resolveConfig() {
    // Defaults < file < ENV < CLI
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

    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        datadogSite: process.env.DATADOG_SITE,
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
        mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
        mobileApplicationId: this.mobileApplicationId,
        versionName: this.versionName,
        latest: this.latest,
      })
    )
  }
}
