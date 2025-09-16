import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {executePluginCommand} from '../../helpers/plugin'

export class CloudRunFlareCommand extends Command {
  public static paths = [['cloud-run', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Gather Cloud Run service configuration and sends it to Datadog.',
  })

  protected isDryRun = Option.Boolean('-d,--dry,--dry-run', false)
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
  protected config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }
  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
