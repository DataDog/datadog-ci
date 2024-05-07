import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

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

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)

export class UploadApplicationCommand extends Command {
  public static paths = [['synthetics', 'upload-application']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Upload a new version to an existing mobile application in Datadog.',
    details: `
      This command will upload a \`.apk\` or \`.ipa\` file as a new version for a given application, which already exists in Datadog.\n
      https://docs.datadoghq.com/mobile_app_testing/mobile_app_tests
    `,
    examples: [
      [
        'Upload version `example 1.0` and mark it as latest',
        "datadog-ci synthetics upload-application --mobileApplicationId '123-123-123' --mobileApplicationVersionFilePath example/test.apk --versionName 'example 1.0' --latest",
      ],
    ],
  })

  private apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  private appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  private configPath = Option.String('--config', {description: `Pass a path to a ${$1('global configuration file')}.`})
  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath', {
    description: 'Override the application version for all Synthetic mobile application tests.',
  })
  private mobileApplicationId = Option.String('--mobileApplicationId', {
    description: 'ID of the application you want to upload the new version to.',
  })
  private versionName = Option.String('--versionName', {description: 'Name of the new version. It has to be unique.'})
  private latest = Option.Boolean('--latest', {
    description:
      'Marks the application as `latest`. Any tests that run on the latest version will use this version on their next run.',
  })

  private config: UploadApplicationCommandConfig = JSON.parse(JSON.stringify(DEFAULT_UPLOAD_COMMAND_CONFIG)) // Deep copy to avoid mutation

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
