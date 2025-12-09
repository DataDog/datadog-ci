import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {LAMBDA_LAYER_VERSIONS} from '../../helpers/serverless/lambda-layer-versions'

import {BaseCommand} from '../..'

const LAYER_VERSIONS_HELP_STRING = Object.entries(LAMBDA_LAYER_VERSIONS)
  .filter(([key, _]) => key !== 'extension')
  .map(([key, value]) => `${key} - ${value}`)
  .join(', ')

export class LambdaInstrumentCommand extends BaseCommand {
  public static paths = [['lambda', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Lambda.',
  })

  protected apmFlushDeadline = Option.String('--apm-flush-deadline', {
    description: `Used to determine when to submit spans before a timeout occurs, in milliseconds. When the remaining time in an AWS Lambda invocation is less than the value set, the tracer attempts to submit the current active spans and all finished spans. Supported for NodeJS and Python. Defaults to '100'`,
  })
  protected appsecEnabled = Option.Boolean('--appsec', false, {
    description: `Enable Application Security Monitoring for the Lambda function. Defaults to 'false'`,
  })
  protected captureLambdaPayload = Option.String('--capture-lambda-payload,--captureLambdaPayload', {
    description: `Whether to capture and store the payload and response of a lambda invocation. Defaults to 'false'`,
  })
  protected configPath = Option.String('--config', {
    description: 'Path to the configuration file',
  })
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview changes running command would apply',
  })
  protected environment = Option.String('--env', {
    description: `Use --env to separate out your staging, development, and production environments. Learn more about the env tag here: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-env-tag`,
  })
  protected extensionVersion = Option.String('-e,--extension-version,--extensionVersion', {
    description: `Version of the Datadog Lambda Extension layer to apply. Defaults to 'none'. Setting this to 'latest' will use version ${LAMBDA_LAYER_VERSIONS['extension']}. When extension version is set, make sure to export DATADOG_API_KEY (or if encrypted, DATADOG_KMS_API_KEY or DATADOG_API_KEY_SECRET_ARN) in your environment as well. Mutually exclusive with the forwarder. Learn more about the Lambda Extension here: https://docs.datadoghq.com/serverless/libraries_integrations/extension`,
  })
  protected extraTags = Option.String('--extra-tags,--extraTags', {
    description: `Add custom tags to your Lambda function in Datadog. Must be a list of <key>:<value> separated by commas such as: layer:api,team:intake`,
  })
  protected flushMetricsToLogs = Option.String('--flush-metrics-to-logs,--flushMetricsToLogs', {
    description: `Whether to send metrics via the Datadog Forwarder asynchronously (https://docs.datadoghq.com/serverless/custom_metrics?tab=python#enabling-asynchronous-custom-metrics). If you disable this parameter, it's required to export DATADOG_API_KEY (or if encrypted, DATADOG_KMS_API_KEY or DATADOG_API_KEY_SECRET_ARN). Defaults to 'true'`,
  })
  protected forwarder = Option.String('--forwarder', {
    description: `The ARN of the datadog forwarder (https://docs.datadoghq.com/logs/guide/forwarder/) to attach this function's LogGroup to`,
  })
  protected functions = Option.Array('-f,--function', [], {
    description: `The ARN of the Lambda function to be instrumented, or the name of the Lambda function (--region must be defined)`,
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: `Allows the user to interactively choose how their function gets instrumented. There is no need to provide any other flags if you choose to use interactive mode since you will be prompted for the information instead`,
  })
  protected layerAWSAccount = Option.String('-a,--layer-account,--layerAccount', {hidden: true})
  protected layerVersion = Option.String('-v,--layer-version,--layerVersion', {
    description: `Version of the Datadog Lambda Library layer to apply. Defaults to 'none'. Setting this to 'latest' will use one of the following versions based on your runtime: ${LAYER_VERSIONS_HELP_STRING}`,
  })
  protected logging = Option.String('--logging', {
    description: `Whether to collect logs using the Lambda Extension. Defaults to 'true'`,
  })
  protected logLevel = Option.String('--log-level,--logLevel', {
    description: `Set to debug to see additional output from the Datadog Lambda Library and/or Lambda Extension for troubleshooting purposes`,
  })
  protected mergeXrayTraces = Option.String('--merge-xray-traces,--mergeXrayTraces', {
    description: `Whether to join dd-trace traces to AWS X-Ray traces. Useful for tracing API Gateway spans. Defaults to 'false'`,
  })
  protected profile = Option.String('--profile', {
    description: `Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles`,
  })
  protected regExPattern = Option.String('--functions-regex,--functionsRegex', {
    description: 'A regex pattern to match with the Lambda function name',
  })
  protected region = Option.String('-r,--region', {
    description: 'Default region to use, when --function is specified by the function name instead of the ARN',
  })
  protected service = Option.String('--service', {
    description: `Use --service to group related functions belonging to similar workloads. Learn more about the service tag here: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-service-tag`,
  })
  protected sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true, {
    description: `Whether to enable Datadog Source Code Integration (https://docs.datadoghq.com/integrations/guide/source-code-integration). This will tag your lambda(s) with the Git repository URL and the latest commit hash of the current local directory. Note: Git repository must not be ahead of remote, and must not be dirty. Defaults to 'true'`,
  })
  protected uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true, {
    description: `Whether to enable Git metadata uploading, as a part of source code integration. Git metadata uploading is only required if you don't have the Datadog Github Integration installed. Defaults to 'true'`,
  })
  protected tracing = Option.String('--tracing', {
    description: `Whether to enable dd-trace tracing on your Lambda. Defaults to 'true'`,
  })
  protected version = Option.String('--version', {
    description: `Add the --version tag to correlate spikes in latency, load or errors to new versions. Learn more about the version tag here: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-version-tag`,
  })
  protected llmobs = Option.String('--llmobs', {
    description: `If specified, enables LLM Observability for the instrumented function(s) with the provided ML application name. Defaults to 'false'`,
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected lambdaFips = Option.Boolean('--lambda-fips', false, {
    description: `Enable FIPS support in the Lambda functions deployed using this tool. Note that for full FIPS compliance, a FIPS endpoint such as ddog-gov.com is required`,
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
