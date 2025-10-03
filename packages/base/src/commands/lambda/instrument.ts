import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class LambdaInstrumentCommand extends BaseCommand {
  public static paths = [['lambda', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Lambda.',
  })

  protected apmFlushDeadline = Option.String('--apm-flush-deadline')
  protected appsecEnabled = Option.Boolean('--appsec', false)
  protected captureLambdaPayload = Option.String('--capture-lambda-payload,--captureLambdaPayload')
  protected configPath = Option.String('--config')
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  protected environment = Option.String('--env')
  protected extensionVersion = Option.String('-e,--extension-version,--extensionVersion')
  protected extraTags = Option.String('--extra-tags,--extraTags')
  protected flushMetricsToLogs = Option.String('--flush-metrics-to-logs,--flushMetricsToLogs')
  protected forwarder = Option.String('--forwarder')
  protected functions = Option.Array('-f,--function', [])
  protected interactive = Option.Boolean('-i,--interactive', false)
  protected layerAWSAccount = Option.String('-a,--layer-account,--layerAccount', {hidden: true})
  protected layerVersion = Option.String('-v,--layer-version,--layerVersion')
  protected logging = Option.String('--logging')
  protected logLevel = Option.String('--log-level,--logLevel')
  protected mergeXrayTraces = Option.String('--merge-xray-traces,--mergeXrayTraces')
  protected profile = Option.String('--profile')
  protected regExPattern = Option.String('--functions-regex,--functionsRegex')
  protected region = Option.String('-r,--region')
  protected service = Option.String('--service')
  protected sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true)
  protected uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true)
  protected tracing = Option.String('--tracing')
  protected version = Option.String('--version')
  protected llmobs = Option.String('--llmobs')

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected lambdaFips = Option.Boolean('--lambda-fips', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
