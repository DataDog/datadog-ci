import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {toBoolean} from '../../helpers/env'

import {EndpointError} from './api'
import {BaseCommand, RecursivePartial} from './base-command'
import {CiError} from './errors'
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
    description: 'The path to the new version of your mobile application (`.apk` or `.ipa`).',
  })
  private mobileApplicationId = Option.String('--mobileApplicationId', {
    description: 'The ID of the application you want to upload the new version to.',
  })
  private versionName = Option.String('--versionName', {
    description: 'The name of the new version. It has to be unique.',
  })
  private latest = Option.Boolean('--latest', {
    description:
      'Mark the new version as `latest`. Any tests that run on the latest version will use this version on their next run.',
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
  }

  protected resolveConfigFromEnv(): RecursivePartial<UploadApplicationCommandConfig> {
    return {
      ...super.resolveConfigFromEnv(),
      mobileApplicationId: process.env.DATADOG_SYNTHETICS_MOBILE_APPLICATION_ID,
      versionName: process.env.DATADOG_SYNTHETICS_VERSION_NAME,
      latest: toBoolean(process.env.DATADOG_SYNTHETICS_LATEST),
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<UploadApplicationCommandConfig> {
    return {
      ...super.resolveConfigFromCli(),
      mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
      mobileApplicationId: this.mobileApplicationId,
      versionName: this.versionName,
      latest: this.latest,
    }
  }
}
