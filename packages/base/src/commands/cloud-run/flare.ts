import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class CloudRunFlareCommand extends BaseCommand {
  public static paths = [['cloud-run', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Gather Cloud Run service configuration and sends it to Datadog.',
  })

  protected isDryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description:
      'Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply.',
  })
  protected withLogs = Option.Boolean('--with-logs', false)
  protected service = Option.String('-s,--service')
  protected project = Option.String('-p,--project')
  protected region = Option.String('-r,--region,-l,--location')
  protected caseId = Option.String('-c,--case-id')
  protected email = Option.String('-e,--email')
  protected start = Option.String('--start')
  protected end = Option.String('--end')

  protected apiKey?: string

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
