import {Option} from 'clipanion'

import {EXTRA_TAGS_REG_EXP, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {dryRunTag} from '../../helpers/renderer'
import {ENV_VAR_REGEX} from '../../helpers/serverless'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'

import {BaseCommand} from '../..'

/**
 * Maps Subscription ID to Resource Group to App Service names.
 */
export type AasBySubscriptionAndGroup = Record<string, Record<string, string[]>>

/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export type AasConfigOptions = Partial<{
  // AAS Targeting options
  subscriptionId: string
  resourceGroup: string
  aasName: string
  resourceIds: string[]

  // Configuration options
  service: string
  environment: string
  version: string
  isInstanceLoggingEnabled: boolean
  logPath: string
  envVars: string[]
  isDotnet: boolean
  isMusl: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  shouldNotRestart: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  sourceCodeIntegration: boolean
  // no-dd-sa:typescript-best-practices/boolean-prop-naming
  uploadGitMetadata: boolean
  extraTags: string
}>

interface Resource {
  subscriptionId: string
  resourceGroup: string
  name: string
}

export const parseResourceId = (resourceId: string): Resource | undefined => {
  const match = resourceId.match(
    /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/Microsoft\.Web\/sites\/([^/]+)$/i
  )
  if (match) {
    const [, subscriptionId, resourceGroup, name] = match

    return {subscriptionId, resourceGroup, name}
  }
}

export abstract class AasCommand extends BaseCommand {
  public dryRun = Option.Boolean('-d,--dry-run', false, {
    description: 'Run the command in dry-run mode, without making any changes',
  })
  private subscriptionId = Option.String('-s,--subscription-id', {
    description: 'Azure Subscription ID containing the App Service',
  })
  private resourceGroup = Option.String('-g,--resource-group', {
    description: 'Name of the Azure Resource Group containing the App Service',
  })
  private aasName = Option.String('-n,--name', {
    description: 'Name of the Azure App Service to instrument',
  })
  private resourceIds = Option.Array('-r,--resource-id', {
    description:
      'Full Azure resource IDs to instrument, eg "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Web/sites/{aasName}"',
  })
  private envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to set for the App Service. Can specify multiple in the form `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })

  private configPath = Option.String('--config', {
    description: 'Path to the configuration file',
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

  public get additionalConfig(): Partial<AasConfigOptions> {
    return {}
  }

  public enableFips(): void {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)
  }

  public async ensureConfig(): Promise<[AasBySubscriptionAndGroup, AasConfigOptions, string[]]> {
    const config = (
      await resolveConfigFromFile<{aas: AasConfigOptions}>(
        {
          aas: {
            subscriptionId: this.subscriptionId,
            resourceGroup: this.resourceGroup,
            aasName: this.aasName,
            envVars: this.envVars,
            ...this.additionalConfig,
          },
        },
        {
          configPath: this.configPath,
          defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        }
      )
    ).aas
    const appServices: AasBySubscriptionAndGroup = {}
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
    // Validate musl setting
    if (config.isMusl && !config.isDotnet) {
      errors.push(
        '--musl can only be set if --dotnet is also set, as it is only relevant for containerized .NET applications.'
      )
    }
    const specifiedSiteArgs = [config.subscriptionId, config.resourceGroup, config.aasName]
    // all or none of the site args should be specified
    if (!(specifiedSiteArgs.every((arg) => arg) || specifiedSiteArgs.every((arg) => !arg))) {
      errors.push('--subscription-id, --resource-group, and --name must be specified together or not at all')
    } else if (specifiedSiteArgs.every((arg) => arg)) {
      appServices[config.subscriptionId!] = {[config.resourceGroup!]: [config.aasName!]}
    }
    if (this.resourceIds?.length) {
      for (const resourceId of this.resourceIds) {
        const parsed = parseResourceId(resourceId)
        if (parsed) {
          const {subscriptionId, resourceGroup, name} = parsed
          if (!appServices[subscriptionId]) {
            appServices[subscriptionId] = {}
          }
          if (!appServices[subscriptionId][resourceGroup]) {
            appServices[subscriptionId][resourceGroup] = []
          }
          appServices[subscriptionId][resourceGroup].push(name)
        } else {
          errors.push(`Invalid AAS resource ID: ${resourceId}`)
        }
      }
    }
    if (!this.resourceIds?.length && specifiedSiteArgs.every((arg) => !arg)) {
      errors.push('No App Services specified to instrument')
    }

    return [appServices, config, errors]
  }
}
