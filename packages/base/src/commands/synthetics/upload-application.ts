/* eslint-disable @typescript-eslint/member-ordering */
import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {makeTerminalLink} from '../../helpers/utils'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'

// BASE COMMAND START
const $B1 = makeTerminalLink(`${datadogDocsBaseUrl}/account_management/api-app-keys`)
const $B2 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#global-configuration-file`
)
const $B3 = makeTerminalLink(`${datadogDocsBaseUrl}/getting_started/site/#access-the-datadog-site`)
// BASE COMMAND END

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

  // BASE COMMAND START
  protected apiKey = Option.String('--apiKey', {
    description: `Your Datadog API key. This key is ${$B1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected appKey = Option.String('--appKey', {
    description: `Your Datadog application key. This key is ${$B1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected configPath = Option.String('--config', {
    description: `The path to the ${$B2`global configuration file`} that configures datadog-ci.`,
  })
  protected datadogSite = Option.String('--datadogSite', {
    description: `Your Datadog site. Possible values are listed ${$B3`in this table`}.`,
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  // BASE COMMAND END

  public mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath', {
    description: 'The path to the new version of your mobile application (`.apk` or `.ipa`).',
  })
  public mobileApplicationId = Option.String('--mobileApplicationId', {
    description: 'The ID of the application you want to upload the new version to.',
  })
  public versionName = Option.String('--versionName', {
    description: 'The name of the new version. It has to be unique.',
  })
  public latest = Option.Boolean('--latest', {
    description:
      'Mark the new version as `latest`. Any tests that run on the latest version will use this version on their next run.',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
