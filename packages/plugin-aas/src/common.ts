import {Site} from '@azure/arm-appservice'
import {AasConfigOptions} from '@datadog/datadog-ci-base/commands/aas/common'
import {renderSoftWarning} from '@datadog/datadog-ci-base/helpers/renderer'
import {getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless'

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

type Print = (arg: string) => void

export const ensureLinux = (print: Print, site: Site): boolean => {
  if (isWindows(site)) {
    print(
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

export const getEnvVars = (config: AasConfigOptions): Record<string, string> => {
  // Get base environment variables
  let envVars = getBaseEnvVars(config)

  // Add .NET-specific environment variables if needed
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

export const isLinuxContainer = (site: Site): boolean => {
  return !!site.siteConfig?.linuxFxVersion && site.siteConfig.linuxFxVersion.toLowerCase() === 'sitecontainers'
}
