import type {EcsFargateConfigOptions} from './common'

import {Command, Option} from 'clipanion'

import {toBoolean} from '../../helpers/env'
import {executePluginCommand} from '../../helpers/plugin'
import {AGENT_IMAGE, EXTRA_TAGS_REG_EXP} from '../../helpers/serverless/constants'

import {EcsFargateCommand} from './common'

export class EcsFargateInstrumentCommand extends EcsFargateCommand {
  public static paths = [['ecs-fargate', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Amazon ECS Fargate task definition.',
  })

  private apiKeySecretArn = Option.String('--api-key-secret-arn,--apiKeySecretArn', {
    description: `The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over \`DD_API_KEY\`, which is written to the task definition in plain text.`,
  })
  private agentImage = Option.String('--agent-image,--sidecar-image', {
    description: `Override to pin a specific version tag or to use a mirrored image from a custom registry (for example, ECR) to avoid pull rate limits. Defaults to '${AGENT_IMAGE}'`,
  })
  // No default, so that leaving the flag off does not override the configuration file.
  private noAgentSocket = Option.Boolean('--no-agent-socket', {
    description:
      'Have the tracers reach the Agent over the task loopback address instead of the Unix socket they use by default. Windows tasks always use the loopback address.',
  })
  private logCollection = Option.Boolean('--log-collection,--logCollection', {
    description: `Send the task's logs to Datadog. Replaces each container's existing log configuration. Not supported on Windows.`,
  })
  private service = Option.String('--service', {
    description:
      'The value for the service tag. Use this to group related tasks belonging to similar workloads. For example, `my-service`. If not provided, the task definition family is used.',
  })
  private environment = Option.String('--env,--environment', {
    description:
      'The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`.',
  })
  private version = Option.String('--version', {
    description:
      'The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`.',
  })
  private extraTags = Option.String('--extra-tags,--extraTags', {
    description: 'Additional tags to add to the task in the format "key1:value1,key2:value2".',
  })
  private envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to set on the application containers and the Datadog Agent. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })
  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', {
    description: `Whether to enable the Datadog Source Code integration. This tags your services with the Git repository and the latest commit hash of the local directory. Specify \`--no-source-code-integration\` to disable. Defaults to 'true'`,
  })
  private uploadGitMetadata = Option.Boolean('--upload-git-metadata,--uploadGitMetadata', {
    description: `Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify \`--no-upload-git-metadata\` to disable. Defaults to 'true'`,
  })
  private tracing = Option.String('--tracing', {
    description:
      'Enables tracing of your application if the tracer is installed. Disable tracing by setting `--tracing false`.',
  })
  private logLevel = Option.String('--log-level,--logLevel', {
    description: 'Specify your Datadog log level.',
  })
  private appsec = Option.Boolean('--appsec', {
    description: `Enable Application Security Monitoring for the instrumented task. Defaults to 'false'`,
  })
  private llmobs = Option.String('--llmobs', {
    description:
      'If specified, enables LLM Observability for the instrumented task with the provided ML application name.',
  })

  public get additionalConfig(): Partial<EcsFargateConfigOptions> {
    return {
      apiKeySecretArn: this.apiKeySecretArn,
      agentImage: this.agentImage,
      agentSocket: this.noAgentSocket === undefined ? undefined : !this.noAgentSocket,
      logCollection: this.logCollection,
      service: this.service,
      environment: this.environment,
      version: this.version,
      extraTags: this.extraTags,
      envVars: this.envVars,
      sourceCodeIntegration: this.sourceCodeIntegration,
      uploadGitMetadata: this.uploadGitMetadata,
      tracing: this.tracing,
      logLevel: this.logLevel,
      appsec: this.appsec,
      llmobs: this.llmobs,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }

  protected additionalErrors(config: EcsFargateConfigOptions): string[] {
    const errors: string[] = []

    if (config.extraTags && !config.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      errors.push('Extra tags do not comply with the <key>:<value> array.')
    }
    if (config.tracing !== undefined && toBoolean(config.tracing) === undefined) {
      errors.push('--tracing must be either `true` or `false`.')
    }

    return errors
  }
}
