import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {executePluginCommand} from '../../helpers/plugin'
import {dryRunTag} from '../../helpers/renderer'
import {AGENT_IMAGE} from '../../helpers/serverless/constants'
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
}>

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
    description: 'Preview changes running command would apply',
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
