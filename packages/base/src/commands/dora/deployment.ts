import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

export class DoraDeploymentCommand extends Command {
  public static paths = [['dora', 'deployment']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Send a new Deployment event for DORA Metrics to Datadog.',
    details: `
    This command sends details to Datadog about a deployment of a service.\n
    See README for more details.
    `,
    examples: [
      [
        'Send a DORA deployment event for a service to the prod environment',
        'datadog-ci dora deployment --service my-service --env prod \\\n' +
          '    --started-at 1699960648 --finished-at 1699961048 \\\n' +
          '    --git-repository-url https://github.com/my-organization/my-repository \\\n' +
          '    --git-commit-sha 102836a25f5477e571c73d489b3f0f183687068e \\\n' +
          '    --version 1.0.0',
      ],
      [
        'Send a DORA deployment event with automatically extracted Git info (for deployments triggered from CI in the same repository as the application). The deployment is assumed to target the current HEAD commit',
        'datadog-ci dora deployment --service my-service --started-at $deploy_start --finished-at `date +%s`',
      ],
      [
        'Send a DORA deployment event to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci dora deployment --service my-service --started-at $deploy_start',
      ],
      [
        'Send a DORA deployment event without git info. Change Lead Time is not available without Git info. The deployment finished-at is set to the current time',
        'datadog-ci dora deployment --service my-service --started-at $deploy_start --skip-git',
      ],
      [
        'Send a DORA deployment event providing the service name and env through environment vars',
        'DD_SERVICE=my-service DD_ENV=prod datadog-ci dora deployment --started-at $deploy_start',
      ],
    ],
  })

  protected serviceParam = Option.String('--service', {env: 'DD_SERVICE'})
  protected env = Option.String('--env', {env: 'DD_ENV'})

  protected startedAt = Option.String('--started-at', {
    required: true,
    validator: t.isDate(),
    description: 'In Unix seconds or ISO8601 (Examples: 1699960648, 2023-11-14T11:17:28Z)',
  })
  protected finishedAt = Option.String('--finished-at', {
    validator: t.isDate(),
    description: 'In Unix seconds or ISO8601 (Examples: 1699961048, 2023-11-14T11:24:08Z)',
  })

  protected version = Option.String('--version', {
    description: 'The version of the service being deployed',
  })

  protected gitRepoURL = Option.String('--git-repository-url', {
    description: 'Example: https://github.com/DataDog/datadog-ci.git',
  })
  protected gitCommitSHA = Option.String('--git-commit-sha', {
    description: 'Example: 102836a25f5477e571c73d489b3f0f183687068e',
  })
  protected skipGit = Option.Boolean('--skip-git', false, {
    description: 'Disables sending git URL and SHA. Change Lead Time will not be available',
  })

  protected team = Option.String('--team', {
    description: 'The team responsible for the deployment',
  })

  protected customTags = Option.Array('--custom-tags', {
    description:
      'Custom tags to add to the deployment event in the format key:value, max 100 tags per deployment event',
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  protected verbose = Option.Boolean('--verbose', false, {hidden: true})
  protected dryRun = Option.Boolean('--dry-run', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
