import type {PagedAsyncIterableIterator} from '@azure/core-paging'

import {Site} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {DATADOG_SITE_US1, EXTRA_TAGS_REG_EXP, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {dryRunTag, renderSoftWarning} from '../../helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'

import {AasConfigOptions} from './interfaces'

export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = '8126'

// Path to tracing libraries, copied within the Docker file
const DD_DOTNET_TRACER_HOME = '/home/site/wwwroot/datadog'
// Where tracer logs are stored
const DD_TRACE_LOG_DIRECTORY = '/home/LogFiles/dotnet'
// Instructs the .NET CLR that profiling should be enabled
const CORECLR_ENABLE_PROFILING = '1'
// Profiler GUID
const CORECLR_PROFILER = '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'
// The profiler binary that the .NET CLR loads into memory, which contains the GUID
const CORECLR_PROFILER_PATH = '/home/site/wwwroot/datadog/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so'

const ENV_VAR_REGEX = /^([\w.]+)=(.*)$/

export const AAS_DD_SETTING_NAMES = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_AAS_INSTANCE_LOGGING_ENABLED',
  'DD_PROFILING_ENABLED',
  'DD_SERVICE',
  'DD_ENV',
  'DD_VERSION',
  'DD_SERVERLESS_LOG_PATH',
  'DD_DOTNET_TRACER_HOME',
  'DD_TRACE_LOG_DIRECTORY',
  'CORECLR_ENABLE_PROFILING',
  'CORECLR_PROFILER',
  'CORECLR_PROFILER_PATH',
  'DD_TAGS',
] as const

/**
 * Maps Subscription ID to Resource Group to App Service names.
 */
export type AasBySubscriptionAndGroup = Record<string, Record<string, string[]>>

export abstract class AasCommand extends Command {
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

  public async ensureAzureAuth(cred: DefaultAzureCredential): Promise<boolean> {
    try {
      await cred.getToken('https://management.azure.com/.default')
    } catch (error) {
      this.context.stdout.write(
        renderSoftWarning(
          `Failed to authenticate with Azure: ${
            error.name
          }\n\nPlease ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run ${chalk.bold(
            'az login'
          )} to authenticate.\n`
        )
      )

      return false
    }

    return true
  }

  public ensureLinux(site: Site): boolean {
    if (isWindows(site)) {
      this.context.stdout.write(
        renderSoftWarning(
          `Unable to instrument ${site.name}. Only Linux-based Azure App Services are currently supported.
Please see the documentation for information on
how to instrument Windows-based App Services:
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows`
        )
      )

      return false
    }

    return true
  }
}

export const parseEnvVars = (envVars: string[] | undefined): Record<string, string> => {
  const result: Record<string, string> = {}
  envVars?.forEach((e) => {
    const match = e.match(ENV_VAR_REGEX)
    if (match) {
      const [, key, value] = match
      result[key] = value
    }
  })

  return result
}

export const getEnvVars = (config: AasConfigOptions): Record<string, string> => {
  let envVars: Record<string, string> = {
    DD_API_KEY: process.env.DD_API_KEY!,
    DD_SITE: process.env.DD_SITE ?? DATADOG_SITE_US1,
    DD_AAS_INSTANCE_LOGGING_ENABLED: (config.isInstanceLoggingEnabled ?? false).toString(),
    ...parseEnvVars(config.envVars),
  }
  if (config.service) {
    envVars.DD_SERVICE = config.service
  }
  if (config.environment) {
    envVars.DD_ENV = config.environment
  }
  if (config.version) {
    envVars.DD_VERSION = config.version
  }
  if (config.logPath) {
    envVars.DD_SERVERLESS_LOG_PATH = config.logPath
  }
  if (config.extraTags) {
    envVars.DD_TAGS = config.extraTags
  }
  if (config.isDotnet) {
    envVars = {
      ...envVars,
      DD_DOTNET_TRACER_HOME,
      DD_TRACE_LOG_DIRECTORY,
      CORECLR_ENABLE_PROFILING,
      CORECLR_PROFILER,
      CORECLR_PROFILER_PATH,
    }
  }

  return envVars
}

export const isWindows = (site: Site): boolean => {
  if (!site.kind) {
    // search for windowsFxVersion in siteConfig if there is no kind
    return !!site.siteConfig?.windowsFxVersion
  }

  return site.kind.includes('windows')
}

export const isDotnet = (site: Site): boolean => {
  return (
    (!!site.siteConfig?.linuxFxVersion && site.siteConfig.linuxFxVersion.toLowerCase().startsWith('dotnet')) ||
    (!!site.siteConfig?.windowsFxVersion && site.siteConfig.windowsFxVersion.toLowerCase().startsWith('dotnet'))
  )
}

export const collectAsyncIterator = async <T>(it: PagedAsyncIterableIterator<T>): Promise<T[]> => {
  const arr = []
  for await (const x of it) {
    arr.push(x)
  }

  return arr
}

/**
 * Formats an error (usually an Azure RestError) object into a string for display.
 */
// no-dd-sa:typescript-best-practices/no-explicit-any
export const formatError = (error: any): string => {
  const errorType = error.code ?? error.name
  const errorMessage = error.details?.message ?? error.message

  return `${errorType}: ${errorMessage}`
}

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
