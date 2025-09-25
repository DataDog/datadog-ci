import {Command, Option} from 'clipanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

export class DeploymentCorrelateImageCommand extends Command {
  public static paths = [['deployment', 'correlate-image']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate images with their source commit.',
    details: 'This command will correlate the image with a commit of the application repository.',
  })

  protected commitSha = Option.String('--commit-sha')
  protected repositoryUrl = Option.String('--repository-url')
  protected image = Option.String('--image')
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected dryRun = Option.Boolean('--dry-run', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
