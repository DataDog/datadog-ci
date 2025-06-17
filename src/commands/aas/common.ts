import type {PagedAsyncIterableIterator} from '@azure/core-paging'

import {Site} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {DATADOG_SITE_US1, FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
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

export const AAS_DD_SETTING_NAMES = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_AAS_INSTANCE_LOGGING_ENABLED',
  'DD_SERVICE',
  'DD_ENV',
  'DD_SERVERLESS_LOG_PATH',
  'DD_DOTNET_TRACER_HOME',
  'DD_TRACE_LOG_DIRECTORY',
  'CORECLR_ENABLE_PROFILING',
  'CORECLR_PROFILER',
  'CORECLR_PROFILER_PATH',
] as const

export type AasDatadogSettingName = typeof AAS_DD_SETTING_NAMES[number]

type AasDatadogConfig = Partial<Record<AasDatadogSettingName, string>>

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

  public async ensureConfig(): Promise<[AasConfigOptions, string[]]> {
    const config = (
      await resolveConfigFromFile<{aas: Partial<AasConfigOptions>}>(
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
    const errors: string[] = []
    if (process.env.DD_API_KEY === undefined) {
      errors.push('DD_API_KEY environment variable is required')
    }
    if (!config.subscriptionId) {
      errors.push('--subscription-id is required')
    }
    if (!config.resourceGroup) {
      errors.push('--resource-group is required')
    }
    if (!config.aasName) {
      errors.push('App Service (--name) is required')
    }

    return [config as AasConfigOptions, errors]
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
          `Only Linux-based Azure App Services are currently supported.
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

export const getEnvVars = (config: AasConfigOptions): AasDatadogConfig => {
  let envVars: AasDatadogConfig = {
    DD_API_KEY: process.env.DD_API_KEY!,
    DD_SITE: process.env.DD_SITE ?? DATADOG_SITE_US1,
    DD_AAS_INSTANCE_LOGGING_ENABLED: (config.isInstanceLoggingEnabled ?? false).toString(),
  }
  if (config.service) {
    envVars.DD_SERVICE = config.service
  }
  if (config.environment) {
    envVars.DD_ENV = config.environment
  }
  if (config.logPath) {
    envVars.DD_SERVERLESS_LOG_PATH = config.logPath
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
