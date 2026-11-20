import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class LambdaFlareCommand extends BaseCommand {
  public static paths = [['lambda', 'flare']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description:
      'Gather config, logs, tags, project files, and more from a Lambda function and sends them to Datadog support.',
  })

  protected isDryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview collected data which would be sent to Datadog support',
  })
  protected withLogs = Option.Boolean('--with-logs', false, {
    description: 'Collect recent CloudWatch logs for the specified function',
  })
  protected functionName = Option.String('-f,--function', {
    description:
      'The ARN of the Lambda function to gather data for, or the name of the Lambda function (--region must be defined)',
  })
  protected region = Option.String('-r,--region', {
    description: 'Default region to use, when --function is specified by the function name instead of the ARN',
  })
  protected caseId = Option.String('-c,--case-id', {
    description: 'The Datadog case ID to send the files to',
  })
  protected email = Option.String('-e,--email', {
    description: 'The email associated with the specified case ID',
  })
  protected start = Option.String('--start', {
    description: `Only gather logs within the time range (--with-logs must be included). This argument is a number in milliseconds since Unix Epoch. Must be used with --end`,
  })
  protected end = Option.String('--end', {
    description: `Only gather logs within the time range (--with-logs must be included). This argument is a number in milliseconds since Unix Epoch. Must be used with --start`,
  })
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
