import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {executePluginCommand} from '../../helpers/plugin'
import {dryRunTag} from '../../helpers/renderer'

import {BaseCommand} from '../..'

export class EcsFargateInstrumentCommand extends BaseCommand {
  public static paths = [['ecs-fargate', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an AWS ECS Fargate Task Definition.',
  })

  protected apiKeySecretArn = Option.String('--api-key-secret-arn,--apiKeySecretArn', {
    description: `The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over DD_API_KEY, which is written to the task definition in plain text`,
  })
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview changes running command would apply',
  })
  protected profile = Option.String('--profile', {
    description: `Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles`,
  })
  protected region = Option.String('-r,--region', {
    description: 'The AWS region the task definition lives in',
  })
  protected taskDefinition = Option.String('--task-definition,--taskDefinition', {
    required: true,
    description: 'The family, family:revision, or ARN of the task definition to instrument',
  })
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public get dryRunPrefix(): string {
    return this.dryRun ? `${dryRunTag} ` : ''
  }

  public enableFips(): void {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
