import {Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {dryRunTag} from '../../helpers/renderer'
import {parseResourceId} from '../../helpers/serverless/azure'
import {ENV_VAR_REGEX, EXTRA_TAGS_REG_EXP} from '../../helpers/serverless/constants'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'

import {BaseCommand} from '../..'

/**
 * Maps Subscription ID to Resource Group to Container App names.
 */
export type ContainerAppBySubscriptionAndGroup = Record<string, Record<string, string[]>>

/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export type ContainerAppConfigOptions = Partial<{
  // Container App Targeting options
  subscriptionId: string
  resourceGroup: string
  containerAppName: string
  resourceIds: string[]

  // Configuration options
  service: string
  environment: string
  version: string
  sidecarName: string
  sharedVolumeName: string
  sharedVolumePath: string
  logsPath: string
  envVars: string[]
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  sourceCodeIntegration: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  uploadGitMetadata: boolean
  extraTags: string
}>

export abstract class ContainerAppCommand extends BaseCommand {
  private subscriptionId = Option.String('-s,--subscription-id', {
    description:
      'Subscription ID of the Azure subscription containing the Container App. Must be used with `--resource-group` and `--name`.',
  })
  private resourceGroup = Option.String('-g,--resource-group', {
    description:
      'Name of the Azure Resource Group containing the Container App. Must be used with `--subscription-id` and `--name`.',
  })
  private containerAppName = Option.String('-n,--name', {
    description:
      'Name of the Azure Container App to instrument. Must be used with `--subscription-id` and `--resource-group`.',
  })
  private resourceIds = Option.Array('-r,--resource-id', {
    description:
      'Full Azure resource ID to instrument. Can be specified multiple times. Format: `/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name>`',
  })
  private envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to set for the Container App. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`',
  })

  private configPath = Option.String('--config', {
    description: 'Path to the configuration file.',
  })

  // eslint-disable-next-line @typescript-eslint/member-ordering -- needed for ordering of arguments in readme
  public dryRun = Option.Boolean('-d,--dry-run', false, {
    description:
      'Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply.',
  })

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public get dryRunPrefix(): string {
    return this.dryRun ? dryRunTag + ' ' : ''
  }

  public get additionalConfig(): Partial<ContainerAppConfigOptions> {
    return {}
  }

  public enableFips(): void {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)
  }

  public async ensureConfig(): Promise<[ContainerAppBySubscriptionAndGroup, ContainerAppConfigOptions, string[]]> {
    const config = (
      await resolveConfigFromFile<{containerApp: ContainerAppConfigOptions}>(
        {
          containerApp: {
            subscriptionId: this.subscriptionId,
            resourceGroup: this.resourceGroup,
            containerAppName: this.containerAppName,
            envVars: this.envVars,
            ...this.additionalConfig,
          },
        },
        {
          configPath: this.configPath,
          defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        }
      )
    ).containerApp
    const containerApps: ContainerAppBySubscriptionAndGroup = {}
    const errors: string[] = []
    if (process.env.DD_API_KEY === undefined) {
      errors.push('DD_API_KEY environment variable is required')
    }
    // Validate that envVars, if provided, are in the format 'key=value'
    if (config.envVars?.some((e) => !ENV_VAR_REGEX.test(e))) {
      errors.push('All envVars must be in the format `KEY=VALUE`')
    }
    // Validate that extraTags, if provided, comply with the expected format
    if (config.extraTags && !config.extraTags.match(EXTRA_TAGS_REG_EXP)) {
      errors.push('Extra tags do not comply with the <key>:<value> array.')
    }
    // Validate that logsPath starts with sharedVolumePath
    if (!config.logsPath || !config.sharedVolumePath) {
      errors.push('logsPath and sharedVolumePath must be non-empty when instance logging is enabled')
    } else if (!config.logsPath.startsWith(config.sharedVolumePath)) {
      errors.push('logsPath must start with sharedVolumePath when instance logging is enabled')
    }
    const specifiedAppArgs = [config.subscriptionId, config.resourceGroup, config.containerAppName]
    // all or none of the app args should be specified
    if (!(specifiedAppArgs.every((arg) => arg) || specifiedAppArgs.every((arg) => !arg))) {
      errors.push('--subscription-id, --resource-group, and --name must be specified together or not at all')
    } else if (specifiedAppArgs.every((arg) => arg)) {
      containerApps[config.subscriptionId!] = {[config.resourceGroup!]: [config.containerAppName!]}
    }
    if (this.resourceIds?.length) {
      for (const resourceId of this.resourceIds) {
        const parsed = parseResourceId(resourceId)
        if (parsed) {
          const {subscriptionId, resourceGroup, name} = parsed
          if (!containerApps[subscriptionId]) {
            containerApps[subscriptionId] = {}
          }
          if (!containerApps[subscriptionId][resourceGroup]) {
            containerApps[subscriptionId][resourceGroup] = []
          }
          containerApps[subscriptionId][resourceGroup].push(name)
        } else {
          errors.push(`Invalid Container App resource ID: ${resourceId}`)
        }
      }
    }
    if (!this.resourceIds?.length && specifiedAppArgs.every((arg) => !arg)) {
      errors.push('No Container Apps specified to instrument')
    }

    return [containerApps, config, errors]
  }
}
