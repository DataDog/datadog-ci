import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

export class LambdaUninstrumentCommand extends Command {
  public static paths = [['lambda', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in a Lambda.',
  })

  protected configPath = Option.String('--config')
  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  protected forwarder = Option.String('--forwarder')
  protected functions = Option.Array('-f,--function', [])
  protected interactive = Option.Boolean('-i,--interactive', false)
  protected profile = Option.String('--profile')
  protected regExPattern = Option.String('--functions-regex,--functionsRegex')
  protected region = Option.String('-r,--region')

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
