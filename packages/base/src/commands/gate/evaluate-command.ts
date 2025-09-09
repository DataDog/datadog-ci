import {executePluginCommand} from '@datadog/datadog-ci-base/helpers/plugin'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'
import {Command, Option} from 'clipanion'

export class GateEvaluateCommand extends Command {
  public static paths = [['gate', 'evaluate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Evaluate Quality Gates rules in Datadog.',
    details: `
      This command will evaluate the matching quality gate rules in Datadog.\n
      See README for details.
    `,
    examples: [
      ['Evaluate matching quality gate rules in Datadog', 'datadog-ci gate evaluate'],
      [
        'Evaluate matching quality gate rules in Datadog, failing if no rules were found',
        'datadog-ci gate evaluate --fail-on-empty',
      ],
      [
        'Evaluate matching quality gate rules in Datadog, failing if Datadog is not available',
        'datadog-ci gate evaluate --fail-if-unavailable',
      ],
      [
        'Evaluate matching quality gate rules in Datadog and add extra scope',
        'datadog-ci gate evaluate --scope team:backend',
      ],
      [
        'Evaluate matching quality gate rules in Datadog and add extra tags',
        'datadog-ci gate evaluate --tags team:frontend',
      ],
      [
        'Evaluate matching quality gate rules in Datadog from the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci gate evaluate',
      ],
      [
        'Evaluate matching quality gate rules in Datadog with a timeout of 120 seconds',
        'datadog-ci gate evaluate --timeout 120',
      ],
      ['Evaluate matching quality gate rules in Datadog without waiting', 'datadog-ci gate evaluate --no-wait'],
    ],
  })

  private defaultTimeout = 600 // 10 min

  protected dryRun = Option.Boolean('--dry-run', false)
  protected failOnEmpty = Option.Boolean('--fail-on-empty', false)
  protected failIfUnavailable = Option.Boolean('--fail-if-unavailable', false)
  protected noWait = Option.Boolean('--no-wait', false)
  protected timeoutInSeconds = Option.String('--timeout', String(this.defaultTimeout), {
    validator: validation.isInteger(),
  })
  protected userScope = Option.Array('--scope')
  protected tags = Option.Array('--tags')

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
