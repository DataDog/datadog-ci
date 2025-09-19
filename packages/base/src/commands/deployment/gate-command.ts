import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'

export class DeploymentGateCommand extends Command {
  public static paths = [['deployment', 'gate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Evaluate deployment gates in Datadog.',
    details: `
      This command allows to evaluate a deployment gate in Datadog.
      The command will exit with status 0 when the gate passes and status 1 otherwise.
    `,
    examples: [
      [
        'Evaluate a deployment gate for payments-backend service in prod environment',
        'datadog-ci deployment gate --service payments-backend --env prod',
      ],
      [
        'Evaluate a deployment gate with custom timeout',
        'datadog-ci deployment gate --service payments-backend --env prod --timeout 7200',
      ],
      [
        'Evaluate a deployment gate and fail if an error occurs',
        'datadog-ci deployment gate --service payments-backend --env prod --fail-on-error',
      ],
      [
        'Evaluate a deployment gate with version and APM primary tag',
        'datadog-ci deployment gate --service payments-backend --env prod --version 1.2.3 --apm-primary-tag region:us-central-1',
      ],
    ],
  })

  // Required parameters
  protected service = Option.String('--service', {
    description: 'The service name (e.g. payments-backend)',
    validator: t.isString(),
  })
  protected env = Option.String('--env', {
    description: 'The environment name (e.g. prod, staging)',
    validator: t.isString(),
  })

  // Optional parameters
  protected identifier = Option.String('--identifier', {
    description: 'The deployment identifier (defaults to "default")',
    validator: t.isString(),
  })
  protected version = Option.String('--version', {
    description: 'The deployment version (required for gates with faulty deployment detection rules)',
    validator: t.isString(),
  })
  protected apmPrimaryTag = Option.String('--apm-primary-tag', {
    description: 'The APM primary tag (only for gates with faulty deployment detection rules)',
    validator: t.isString(),
  })
  protected timeout = Option.String('--timeout', '10800', {
    description: 'Maximum amount of seconds to wait for the script execution in seconds (default: 10800 = 3 hours)',
    validator: t.isString(),
  })
  protected failOnError = Option.Boolean('--fail-on-error', false, {
    description:
      'When true, the script will consider the gate as failed when timeout is reached or unexpected errors occur calling the Datadog APIs',
  })
  // monitorsQueryVariable is hidden because it's not available yet
  protected monitorsQueryVariable = Option.String('--monitors-query-variable', '', {
    validator: t.isString(),
    hidden: true,
  })

  // FIPS options
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
