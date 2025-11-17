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
    description: 'Preview data that will be sent to Datadog support.',
  })
  protected withLogs = Option.Boolean('--with-logs', false, {
    description: 'Collect recent logs for the specified service.',
  })
  protected service = Option.String('-s,--service', {description: 'The name of the Cloud Run service.'})
  protected project = Option.String('-p,--project', {
    description: 'The name of the Google Cloud project where the Cloud Run service is hosted.',
  })
  protected region = Option.String('-r,--region,-l,--location', {
    description: 'The region where the Cloud Run service is hosted.',
  })
  protected caseId = Option.String('-c,--case-id', {description: 'The Datadog case ID to send the files to.'})
  protected email = Option.String('-e,--email', {description: 'The email associated with the specified case ID.'})
  protected start = Option.String('--start', {
    description: 'Only gather logs after the time in milliseconds since Unix Epoch. (`--with-logs` must be specified.)',
  })
  protected end = Option.String('--end', {
    description:
      'Only gather logs before the time in milliseconds since Unix Epoch. (`--with-logs` must be specified.)',
  })

  protected apiKey?: string

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
