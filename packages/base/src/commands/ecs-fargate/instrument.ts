import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {executePluginCommand} from '../../helpers/plugin'
import {dryRunTag} from '../../helpers/renderer'
import {AGENT_IMAGE, ENV_VAR_REGEX, EXTRA_TAGS_REG_EXP} from '../../helpers/serverless/constants'
import {DEFAULT_CONFIG_PATHS, removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'

import {BaseCommand} from '../..'

export type EcsFargateConfigOptions = Partial<{
  // Task definition targeting options
  taskDefinitions: string[]
  region: string
  profile: string

  // Rollout options
  ecsServices: string[]
  cluster: string

  // Configuration options
  apiKeySecretArn: string
  agentImage: string
  agentSocket: boolean
  service: string
  environment: string
  version: string
  extraTags: string
  envVars: string[]
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  sourceCodeIntegration: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  uploadGitMetadata: boolean
  tracing: string
  logLevel: string
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  appsec: boolean
  llmobs: string
}>

/**
 * The family a `--task-definition` names, whether it is given as a family, a `family:revision`, or
 * a full task definition ARN.
 */
const familyFromTaskDefinition = (taskDefinition: string): string =>
  (taskDefinition.split('/').pop() ?? taskDefinition).split(':')[0]
/**
 * Finds families that are named more than once as a task definition family can only be instrumented once
 */
const duplicateFamilies = (taskDefinitions: string[]): string[] => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const family of taskDefinitions.map(familyFromTaskDefinition)) {
    if (seen.has(family)) {
      duplicates.add(family)
    }
    seen.add(family)
  }

  return [...duplicates]
}

/**
 * Derive the cluster from an ECS service ARN
 */
const clusterFromServiceArn = (service: string): string | undefined => {
  if (!service.startsWith('arn:')) {
    return undefined
  }

  const segments = service.split('/')

  return segments.length === 3 ? segments[1] : undefined
}

/**
 * The cluster the services to update run in, derived from `--cluster` or from the service ARNs naming them.
 * Conflicting Clusters are rejected
 */
const resolveCluster = (cluster: string | undefined, services: string[]): [string | undefined, string[]] => {
  const named = [
    ...new Set(services.map(clusterFromServiceArn).filter((value): value is string => value !== undefined)),
  ]

  if (cluster) {
    const conflicting = named.filter((value) => value !== cluster)

    return [
      cluster,
      conflicting.length > 0
        ? [`--cluster ${cluster} is not the cluster the service ARNs name (${conflicting.join(', ')}).`]
        : [],
    ]
  }

  if (named.length > 1) {
    return [
      undefined,
      [`The service ARNs name several clusters (${named.join(', ')}), and a run updates services in one cluster.`],
    ]
  }

  return [named[0], []]
}

export class EcsFargateInstrumentCommand extends BaseCommand {
  public static paths = [['ecs-fargate', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an AWS ECS Fargate Task Definition.',
  })

  protected dryRun = Option.Boolean('-d,--dry,--dry-run', false, {
    description: 'Preview the changes the command would apply',
  })

  private taskDefinitions = Option.Array('--task-definition,--taskDefinition', {
    description:
      'The family, family:revision, or ARN of the task definition to instrument. Can be specified multiple times.',
  })
  private region = Option.String('-r,--region', {
    description: 'The AWS region the task definition lives in',
  })
  private profile = Option.String('--profile', {
    description: `Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles`,
  })
  private ecsServices = Option.Array('--ecs-service,--ecsService', {
    description:
      'The name of an ECS service to update to the newly instrumented revision, so that the change rolls out without a manual deployment. Can be specified multiple times.',
  })
  private cluster = Option.String('--cluster', {
    description:
      'The ECS cluster the services named by `--ecs-service` run in. Not needed when those are full ARNs, which name their own cluster. Omit it for the `default` cluster of the region.',
  })
  private apiKeySecretArn = Option.String('--api-key-secret-arn,--apiKeySecretArn', {
    description: `The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over DD_API_KEY, which is written to the task definition in plain text`,
  })
  private agentImage = Option.String('--agent-image,--sidecar-image', {
    description: `Override to pin a specific version tag or to use a mirrored image from a custom registry (for example, ECR) to avoid pull rate limits. Defaults to '${AGENT_IMAGE}'`,
  })
  // No default, so that leaving the flag off does not override the configuration file.
  private noAgentSocket = Option.Boolean('--no-agent-socket', {
    description:
      'Have the tracers reach the Agent over the task loopback address instead of the Unix socket they use by default.',
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
      'Additional environment variables to set on every container in the task. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })
  private sourceCodeIntegration = Option.Boolean('--source-code-integration,--sourceCodeIntegration', {
    description: `Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify \`--no-source-code-integration\` to disable. Defaults to 'true'`,
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
  private configPath = Option.String('--config', {
    description: 'Path to the configuration file.',
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

  /**
   * The configuration to instrument with, along with everything wrong with it. The caller reports
   * the problems, so that a run with several mistakes in it names them all at once.
   */
  public async ensureConfig(): Promise<[EcsFargateConfigOptions, string[]]> {
    const flags: EcsFargateConfigOptions = {
      taskDefinitions: this.taskDefinitions,
      region: this.region,
      profile: this.profile,
      ecsServices: this.ecsServices,
      cluster: this.cluster,
      apiKeySecretArn: this.apiKeySecretArn,
      agentImage: this.agentImage,
      agentSocket: this.noAgentSocket === undefined ? undefined : !this.noAgentSocket,
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

    let fileConfig: EcsFargateConfigOptions
    try {
      fileConfig = (
        await resolveConfigFromFile<{ecsFargate: EcsFargateConfigOptions}>(
          {ecsFargate: {}},
          {configPath: this.configPath, defaultConfigPaths: DEFAULT_CONFIG_PATHS}
        )
      ).ecsFargate
    } catch (error) {
      return [flags, [`Could not read the configuration file: ${error instanceof Error ? error.message : error}`]]
    }

    const config: EcsFargateConfigOptions = {...fileConfig, ...removeUndefinedValues(flags)}

    const errors: string[] = []
    if (!config.taskDefinitions?.length) {
      errors.push('No task definitions specified to instrument. Use --task-definition.')
    }

    const duplicates = duplicateFamilies(config.taskDefinitions ?? [])
    if (duplicates.length > 0) {
      errors.push(
        `--task-definition names the same task definition family more than once (${duplicates.join(
          ', '
        )}). A run instruments one revision per family, so name the revision to instrument once.`
      )
    }

    if (config.envVars?.some((envVar) => !ENV_VAR_REGEX.test(envVar))) {
      errors.push('All env vars must be in the format `KEY=VALUE`')
    }
    if (config.extraTags && !config.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      errors.push('Extra tags do not comply with the <key>:<value> array.')
    }
    if (config.tracing !== undefined && toBoolean(config.tracing) === undefined) {
      errors.push('--tracing must be either `true` or `false`.')
    }
    if (config.cluster && !config.ecsServices?.length) {
      errors.push('--cluster names the cluster of the services to update, so it only applies with --ecs-service.')
    }

    const [cluster, clusterErrors] = resolveCluster(config.cluster, config.ecsServices ?? [])
    errors.push(...clusterErrors)

    return [{...config, cluster}, errors]
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
