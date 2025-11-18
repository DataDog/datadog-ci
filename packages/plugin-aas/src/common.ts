import {Site} from '@azure/arm-appservice'
import {AasConfigOptions} from '@datadog/datadog-ci-base/commands/aas/common'
import {getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'

// Path to tracing libraries, copied within the Docker file
const DD_DOTNET_TRACER_HOME_CODE = '/home/site/wwwroot/datadog'
const DD_DOTNET_TRACER_HOME_CONTAINER = '/datadog/tracer'
// The instrumentation binary that the .NET CLR loads into memory, which contains the GUID
const CORECLR_PROFILER_PATH = '/linux-x64/Datadog.Trace.ClrProfiler.Native.so'
const CORECLR_PROFILER_PATH_MUSL = '/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so'
// Where tracer logs are stored
const DD_TRACE_LOG_DIRECTORY = '/home/LogFiles/dotnet'
// Instructs the .NET CLR that the Profiling APIs should be enabled (used by the .NET instrumentation library, dd-trace-dotnet)
const CORECLR_ENABLE_PROFILING = '1'
// GUID of .NET instrumentation library (dd-trace-dotnet)
const CORECLR_PROFILER = '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}'

export const AAS_DD_SETTING_NAMES = [
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

export type WindowsRuntime = 'node' | 'dotnet' | 'java'

/**
 * Detects the runtime of a Windows-based Azure App Service
 * @param site The Azure App Service site
 * @returns The detected runtime or undefined if unable to detect
 */
export const getWindowsRuntime = (site: Site): WindowsRuntime | undefined => {
  if (!!site.siteConfig?.netFrameworkVersion) {
    return 'dotnet'
  }
  if (!!site.siteConfig?.javaVersion) {
    return 'java'
  }
  // Needed because node isn't always configured the traditional way
  // https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs?pivots=platform-windows
  if (!!site.siteConfig?.nodeVersion || site.siteConfig?.appSettings?.some(({name}) => name?.toLowerCase() === 'website_node_default_version')) {
    return 'node'
  }

  return undefined
}

export const SITE_EXTENSION_IDS: Record<WindowsRuntime, string> = {
  node: 'Datadog.AzureAppServices.Node.Apm',
  dotnet: 'Datadog.AzureAppServices.DotNet',
  java: 'Datadog.AzureAppServices.Java.Apm',
}

export const getEnvVars = (config: AasConfigOptions, isContainer: boolean): Record<string, string> => {
  // Get base environment variables
  let envVars = getBaseEnvVars(config)
  envVars = {
    DD_AAS_INSTANCE_LOGGING_ENABLED: (config.isInstanceLoggingEnabled ?? false).toString(),
    ...envVars,
  }

  // Add .NET-specific environment variables if needed
  if (config.isDotnet) {
    const tracerHome = isContainer ? DD_DOTNET_TRACER_HOME_CONTAINER : DD_DOTNET_TRACER_HOME_CODE
    envVars = {
      ...envVars,
      DD_DOTNET_TRACER_HOME: tracerHome,
      CORECLR_PROFILER_PATH: tracerHome + (config.isMusl ? CORECLR_PROFILER_PATH_MUSL : CORECLR_PROFILER_PATH),
      DD_TRACE_LOG_DIRECTORY,
      CORECLR_ENABLE_PROFILING,
      CORECLR_PROFILER,
    }
  }

  return envVars
}

export const isWindows = (site: Site): boolean => {
  if (!site.kind) {
    // search for windowsFxVersion in siteConfig if there is no kind
    return !!site.siteConfig?.windowsFxVersion
  }

  return !site.kind.includes('linux')
}

export const isDotnet = (site: Site): boolean => {
  return (
    (!!site.siteConfig?.linuxFxVersion && site.siteConfig.linuxFxVersion.toLowerCase().startsWith('dotnet')) ||
    (!!site.siteConfig?.windowsFxVersion && site.siteConfig.windowsFxVersion.toLowerCase().startsWith('dotnet'))
  )
}

export const isLinuxContainer = (site: Site): boolean => {
  if (!site.siteConfig?.linuxFxVersion) {
    return false
  }
  const linuxFxVersion = site.siteConfig.linuxFxVersion.toLowerCase()

  return (
    linuxFxVersion === 'sitecontainers' || linuxFxVersion.startsWith('docker|') || linuxFxVersion.startsWith('compose|')
  )
}
