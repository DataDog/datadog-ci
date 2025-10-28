import type {PagedAsyncIterableIterator} from '@azure/core-paging'

import {ContainerApp} from '@azure/arm-appcontainers'
import {DefaultAzureCredential} from '@azure/identity'
import {ContainerAppConfigOptions, ENV_VAR_REGEX} from '@datadog/datadog-ci-base/commands/container-app/common'
import {DATADOG_SITE_US1} from '@datadog/datadog-ci-base/constants'
import {renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import chalk from 'chalk'

export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = 8126

// Path to tracing libraries, copied within the Docker file
const DD_DOTNET_TRACER_HOME = '/home/site/wwwroot/datadog'
// Where tracer logs are stored
const DD_TRACE_LOG_DIRECTORY = '/home/LogFiles/dotnet'
// Instructs the .NET CLR that profiling should be enabled
const CORECLR_ENABLE_PROFILING = '1'
// Profiler GUID
const CORECLR_PROFILER = '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'

// The profiler binary that the .NET CLR loads into memory, which contains the GUID
const CORECLR_PROFILER_PATH = '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so'
const CORECLR_PROFILER_PATH_MUSL = '/home/site/wwwroot/datadog/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so'

export const CONTAINER_APP_DD_SETTING_NAMES = [
  'DD_API_KEY',
  'DD_SITE',
  'DD_AAS_INSTANCE_LOGGING_ENABLED',
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

type Print = (arg: string) => void

export const ensureAzureAuth = async (print: Print, cred: DefaultAzureCredential): Promise<boolean> => {
  try {
    await cred.getToken('https://management.azure.com/.default')
  } catch (error) {
    print(
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

export const getEnvVars = (config: ContainerAppConfigOptions): Record<string, string> => {
  let envVars: Record<string, string> = {
    DD_API_KEY: process.env.DD_API_KEY!,
    DD_SITE: process.env.DD_SITE ?? DATADOG_SITE_US1,
    DD_SERVICE: config.service!,
    DD_AAS_INSTANCE_LOGGING_ENABLED: (config.isInstanceLoggingEnabled ?? false).toString(),
    ...parseEnvVars(config.envVars),
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
      CORECLR_PROFILER_PATH: config.isMusl ? CORECLR_PROFILER_PATH_MUSL : CORECLR_PROFILER_PATH,
    }
  }

  return envVars
}

export const isDotnet = (containerApp: ContainerApp): boolean => {
  // Check if any container in the Container App uses a .NET-based image
  const containers = containerApp.template?.containers ?? []

  return containers.some((container) => container.image?.toLowerCase().includes('dotnet'))
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
