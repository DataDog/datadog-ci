import {Site} from '@azure/arm-appservice'
import {AasConfigOptions, WindowsRuntime} from '@datadog/datadog-ci-base/commands/aas/common'
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
  'WEBSITES_ENABLE_APP_SERVICE_STORAGE',
] as const

/**
 * Detects the runtime of a Windows-based Web App
 * @param site The web app or slot
 * @param envVars The environment variables on the web app or slot
 * @returns The detected runtime or undefined if unable to detect
 */
export const getWindowsRuntime = (site: Site, envVars: Record<string, string>): WindowsRuntime | undefined => {
  // Needed because node isn't always configured the traditional way
  // https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs?pivots=platform-windows
  if (!!site.siteConfig?.nodeVersion || 'WEBSITE_NODE_DEFAULT_VERSION' in envVars) {
    return 'node'
  }
  if (!!site.siteConfig?.javaVersion) {
    return 'java'
  }
  // netFrameworkVersion is sometimes erroneously set, so we check the other two runtimes before this one
  if (!!site.siteConfig?.netFrameworkVersion) {
    return 'dotnet'
  }

  return undefined
}

export const getEnvVars = (config: AasConfigOptions, isContainer: boolean): Record<string, string> => {
  // Get base environment variables
  let envVars = getBaseEnvVars(config)
  envVars = {
    WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
