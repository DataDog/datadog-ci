import {Command, Option} from 'clipanion'

import {toBoolean} from '../../helpers/env'

import {EndpointError} from './api'
import {BaseCommand} from './base-command'
import {CiError, CriticalError} from './errors'
import {UploadApplicationCommandConfig} from './interfaces'
import {uploadMobileApplicationVersion} from './mobile'
import {AppUploadReporter} from './reporters/mobile/app-upload'

export class UploadApplicationCommand extends BaseCommand {
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

  protected config: UploadApplicationCommandConfig = UploadApplicationCommand.getDefaultConfig()

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

  public static getDefaultConfig(): UploadApplicationCommandConfig {
    return {
      ...super.getDefaultConfig(),
      mobileApplicationVersionFilePath: '',
      mobileApplicationId: '',
      versionName: '',
      latest: false,
    }
  }

  public async execute() {
    await this.setup()

    const appUploadReporter = new AppUploadReporter(this.context)
    try {
      await uploadMobileApplicationVersion(this.config, appUploadReporter)
    } catch (error) {
      if (error instanceof CiError || error instanceof EndpointError || error instanceof CriticalError) {
        this.logger.error(`Error: ${error.message}`)
      }

      return 1
    }
  }

  protected resolveConfigFromEnv(): Partial<UploadApplicationCommandConfig> {
    return {
      ...super.resolveConfigFromEnv(),
      mobileApplicationId: process.env.DATADOG_SYNTHETICS_MOBILE_APPLICATION_ID,
      versionName: process.env.DATADOG_SYNTHETICS_VERSION_NAME,
      latest: toBoolean(process.env.DATADOG_SYNTHETICS_LATEST),
    }
  }

  protected resolveConfigFromCli(): Partial<UploadApplicationCommandConfig> {
    return {
      ...super.resolveConfigFromCli(),
      mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
      mobileApplicationId: this.mobileApplicationId,
      versionName: this.versionName,
      latest: this.latest,
    }
  }
}
