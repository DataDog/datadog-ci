import {Command, Option} from 'clipanion'

import {apiKeyAuth} from '../../helpers/auth'
import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class AndroidSymbolsUploadCommand extends BaseCommand {
  public static paths = [['android-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload an Android ProGuard or R8 mapping file to Datadog.',
    details: `
      Uploads Java/Kotlin obfuscation mappings independently of the application framework or build system.
      Requires the build ID packaged in the application, either directly or from its datadog.buildId file.
      A missing build ID or an unsuccessful upload returns a non-zero exit code.
    `,
    examples: [
      [
        'Upload a mapping and its build ID produced by the MAUI SDK',
        'datadog-ci android-symbols upload ./datadog-android-symbols/mapping.txt --build-id-file ./datadog-android-symbols/datadog.buildId --service my-app --version 1.0.0',
      ],
    ],
  })

  public static authRequirement = apiKeyAuth

  protected mappingFile = Option.String()
  protected buildId = Option.String('--build-id')
  protected buildIdFile = Option.String('--build-id-file')
  protected service = Option.String('--service', {required: true})
  protected version = Option.String('--version', {required: true})
  protected variant = Option.String('--variant', '')
  protected configPath = Option.String('--config')
  protected dryRun = Option.Boolean('--dry-run', false)
  protected disableGit = Option.Boolean('--disable-git', false)
  protected repositoryUrl = Option.String('--repository-url')
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
