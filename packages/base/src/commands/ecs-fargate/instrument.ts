import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class EcsFargateInstrumentCommand extends BaseCommand {
  public static paths = [['ecs-fargate', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an AWS ECS Fargate Task Definition.',
  })
  protected appsecEnabled = Option.Boolean('--appsec', false, {
    description: `Enable Application Security Monitoring for the service. Defaults to 'false'`,
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
  protected extraTags = Option.String('--extra-tags,--extraTags', {
    description: `Add custom tags to your service in Datadog. Must be a list of <key>:<value> separated by commas such as: layer:api,team:intake`,
  })
  protected interactive = Option.Boolean('-i,--interactive', false, {
    description: `Allows the user to interactively choose how their function gets instrumented. There is no need to provide any other flags if you choose to use interactive mode since you will be prompted for the information instead`,
  })
  protected logging = Option.String('--logging', {
    description: `Whether to collect logs using the datadog agent. Defaults to 'true'`,
  })
  protected logLevel = Option.String('--log-level,--logLevel', {
    description: `Set to debug to see additional output from the Datadog agent and/or tracer for troubleshooting purposes`,
  })
  protected profile = Option.String('--profile', {
    description: `Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles`,
  })
  protected region = Option.String('-r,--region', {
    description: 'Default region to use',
  })
  protected cluster = Option.String('-r,--region', {
    description: 'Default cluster to use',
  })
  protected service = Option.String('--service', {
    description: `Use --service to group related tasks belonging to similar workloads. Learn more about the service tag here: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-service-tag`,
  })
  protected sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true, {
    description: `Whether to enable Datadog Source Code Integration (https://docs.datadoghq.com/integrations/guide/source-code-integration). This will tag your services with the Git repository URL and the latest commit hash of the current local directory. Note: Git repository must not be ahead of remote, and must not be dirty. Defaults to 'true'`,
  })
  protected uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true, {
    description: `Whether to enable Git metadata uploading, as a part of source code integration. Git metadata uploading is only required if you don't have the Datadog Github Integration installed. Defaults to 'true'`,
  })
  protected tracing = Option.String('--tracing', {
    description: `Whether to enable dd-trace tracing on your service. Defaults to 'true'`,
  })
  protected version = Option.String('--version', {
    description: `Add the --version tag to correlate spikes in latency, load or errors to new versions. Learn more about the version tag here: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-version-tag`,
  })
  protected llmobs = Option.String('--llmobs', {
    description: `If specified, enables LLM Observability for the instrumented ECS task with the provided ML application name. Defaults to 'false'`,
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
