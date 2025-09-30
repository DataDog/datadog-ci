import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {isInteger} from '../../helpers/validation'

export class SarifUploadCommand extends Command {
  public static paths = [['sarif', 'upload']]

  public static usage = Command.Usage({
    category: 'Static Analysis',
    description: 'Upload SARIF reports files to Datadog.',
    details: `
      This command will upload SARIF reports files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all SARIF report files in current directory', 'datadog-ci sarif upload .'],
      [
        'Upload all SARIF report files in src/sarif-go-reports and src/sarif-java-reports',
        'datadog-ci sarif upload src/sarif-go-reports src/sarif-java-reports',
      ],
      [
        'Upload all SARIF report files in current directory and add extra tags globally',
        'datadog-ci sarif upload --tags key1:value1 --tags key2:value2 .',
      ],
      [
        'Upload all SARIF report files in current directory to the datadoghq.eu site',
        'DATADOG_SITE=datadoghq.eu datadog-ci sarif upload .',
      ],
    ],
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  protected basePaths = Option.Rest({required: 1})
  protected dryRun = Option.Boolean('--dry-run', false)
  protected env = Option.String('--env', 'ci')
  protected maxConcurrency = Option.String('--max-concurrency', '20', {validator: isInteger()})
  protected serviceFromCli = Option.String('--service')
  protected tags = Option.Array('--tags')
  protected gitPath = Option.String('--git-repository')
  protected noVerify = Option.Boolean('--no-verify', false)
  protected noCiTags = Option.Boolean('--no-ci-tags', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
