import {Command} from 'clipanion'
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
  // CLI arguments
  private apiKey?: string
  private appKey?: string
  private configPath?: string
  private datadogSite?: string
  private latest?: boolean
  private mobileApplicationId?: string
  private mobileApplicationVersionFilePath?: string
  private versionName?: string

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  private config = JSON.parse(JSON.stringify(DEFAULT_UPLOAD_COMMAND_CONFIG)) as UploadApplicationCommandConfig // Deep copy to avoid mutation during unit tests

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

UploadApplicationCommand.addPath('synthetics', 'upload-application')
UploadApplicationCommand.addOption('apiKey', Command.String('--apiKey'))
UploadApplicationCommand.addOption('appKey', Command.String('--appKey'))
UploadApplicationCommand.addOption('configPath', Command.String('--config'))
UploadApplicationCommand.addOption('datadogSite', Command.String('--datadogSite'))
UploadApplicationCommand.addOption(
  'mobileApplicationVersionFilePath',
  Command.String('--mobileApp,--mobileApplicationVersionFilePath')
)
UploadApplicationCommand.addOption('mobileApplicationId', Command.String('--mobileApplicationId'))
UploadApplicationCommand.addOption('versionName', Command.String('--versionName'))
UploadApplicationCommand.addOption('latest', Command.Boolean('--latest'))
