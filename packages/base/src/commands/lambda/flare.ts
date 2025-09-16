import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

export class LambdaFlareCommand extends Command {
  public static paths = [['lambda', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description:
      'Gather config, logs, tags, project files, and more from a Lambda function and sends them to Datadog support.',
  })

  protected isDryRun = Option.Boolean('-d,--dry,--dry-run', false)
  protected withLogs = Option.Boolean('--with-logs', false)
  protected functionName = Option.String('-f,--function')
  protected region = Option.String('-r,--region')
  protected caseId = Option.String('-c,--case-id')
  protected email = Option.String('-e,--email')
  protected start = Option.String('--start')
  protected end = Option.String('--end')
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
