import {Command, Option} from 'clipanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

export class DeploymentMarkCommand extends Command {
  public static paths = [['deployment', 'mark']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Mark a CI job as a deployment.',
    details: `
      This command will mark a CI job as a deployment.\n
      See README for details.
    `,
    examples: [
      ['Mark a CI job as a deployment', 'datadog-ci deployment mark'],
      ['Mark a CI job as a deployment to the staging environment', 'datadog-ci deployment mark --env:staging'],
      ['Mark a CI job as a rollback deployment', 'datadog-ci deployment mark --is-rollback'],
      ['Mark a CI job as a deployment of the v123-456 version', 'datadog-ci deployment mark --revision:v123-456'],
      [
        'Mark a CI job as a deployment for service payment-service',
        'datadog-ci deployment mark --service:payment-service',
      ],
    ],
  })

  protected noFail = Option.Boolean('--no-fail', false)
  protected isRollback = Option.Boolean('--is-rollback', false)
  protected env = Option.String('--env', {
    description: 'Example: prod',
  })
  protected revision = Option.String('--revision', {
    description: 'Example: 1.0.0',
  })
  protected service = Option.String('--service', {
    description: 'Example: payment-service',
  })
  protected tags = Option.Array('--tags')

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
