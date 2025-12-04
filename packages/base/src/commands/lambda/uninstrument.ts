import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class LambdaUninstrumentCommand extends BaseCommand {
  public static paths = [['lambda', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Lambda.',
  })

  protected configPath = Option.String('--config', {
    description: 'Path to the configuration file',
  })
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview changes running command would apply',
  })
  protected forwarder = Option.String('--forwarder', {
    description: `The ARN of the datadog forwarder (https://docs.datadoghq.com/serverless/forwarder/) to remove from this function`,
  })
  protected functions = Option.Array('-f,--function', [], {
    description: `The ARN of the Lambda function to be uninstrumented, or the name of the Lambda function (--region must be defined)`,
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: `Allows the user to interactively choose how their function gets uninstrumented. There is no need to provide any other flags if you choose to use interactive mode since you will be prompted for the information instead`,
  })
  protected profile = Option.String('--profile', {
    description: `Specify the AWS named profile credentials to use to uninstrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles`,
  })
  protected regExPattern = Option.String('--functions-regex,--functionsRegex', {
    description: 'A regex pattern to match with the Lambda function name to be uninstrumented',
  })
  protected region = Option.String('-r,--region', {
    description: 'Default region to use, when --function is specified by the function name instead of the ARN',
  })

  /**
   * Arguments that are not really in use, but to
   * make uninstrumentation easier for the user.
   */
  protected layerVersion = Option.String('-v,--layer-version,--layerVersion', {hidden: true})
  protected tracing = Option.String('--tracing', {hidden: true})
  protected logLevel = Option.String('--log-level,--logLevel', {hidden: true})
  protected service = Option.String('--service', {hidden: true})
  protected environment = Option.String('--env', {hidden: true})
  protected version = Option.String('--version', {hidden: true})
  protected appsecEnabled = Option.Boolean('--appsec', {hidden: true})
  protected apmFlushDeadline = Option.String('--apm-flush-deadline', {hidden: true})
  protected extraTags = Option.String('--extra-tags,--extraTags', {hidden: true})
  protected extensionVersion = Option.String('-e,--extension-version,--extensionVersion', {hidden: true})
  protected mergeXrayTraces = Option.String('--merge-xray-traces,--mergeXrayTraces', {hidden: true})
  protected flushMetricsToLogs = Option.String('--flush-metrics-to-logs,--flushMetricsToLogs', {hidden: true})
  protected captureLambdaPayload = Option.String('--capture-lambda-payload,--captureLambdaPayload', {hidden: true})

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
