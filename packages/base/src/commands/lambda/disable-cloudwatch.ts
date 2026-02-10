import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class LambdaDisableCloudwatchCommand extends BaseCommand {
  public static paths = [['lambda', 'disable-cloudwatch']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Disable CloudWatch Logs for Lambda functions by attaching a deny IAM policy.',
  })

  protected configPath = Option.String('--config', {
    description: 'Path to the configuration file',
  })
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview changes running command would apply',
  })
  protected functions = Option.Array('-f,--function', [], {
    description: 'The ARN of the Lambda function, or the name of the Lambda function (--region must be defined)',
  })
  protected profile = Option.String('--profile', {
    description:
      'Specify the AWS named profile credentials to use. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles',
  })
  protected regExPattern = Option.String('--functions-regex,--functionsRegex', {
    description: 'A regex pattern to match with the Lambda function name',
  })
  protected region = Option.String('-r,--region', {
    description: 'Default region to use, when --function is specified by the function name instead of the ARN',
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
