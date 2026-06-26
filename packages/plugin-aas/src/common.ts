import type {Site, SlotConfigNamesResource, WebSiteManagementClient} from '@azure/arm-appservice'
import type {AasConfigOptions, WebApp, WindowsRuntime} from '@datadog/datadog-ci-base/commands/aas/common'

import {getBaseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import chalk from 'chalk'

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

// Disabling private site extensions releases the Functions runtime's locks on the SiteExtensions
// directory before the extension install (datadog-aas-extension#457).
export const WEBSITE_PRIVATE_EXTENSIONS = 'WEBSITE_PRIVATE_EXTENSIONS'

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

export const getEnvVars = (config: AasConfigOptions, site: Site, webApp: WebApp): Record<string, string> => {
  const isContainer = isLinuxContainer(site)
  // Function App slots need private extensions disabled before the extension install.
  const includePrivateExtensions = isWindowsFunctionApp(site) && !!webApp.slot

  // Get base environment variables
  let envVars = getBaseEnvVars(config)
  envVars = {
    WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
    DD_AAS_INSTANCE_LOGGING_ENABLED: (config.isInstanceLoggingEnabled ?? false).toString(),
    ...(includePrivateExtensions ? {[WEBSITE_PRIVATE_EXTENSIONS]: '0'} : {}),
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

export const AZURE_FUNCTIONS_DOCS_URL = 'https://docs.datadoghq.com/serverless/azure_functions'
export const AZURE_WINDOWS_FUNCTIONS_DOCS_URL = 'https://docs.datadoghq.com/serverless/azure_functions/dotnet_extension'

export const isFunctionApp = (site: Site): boolean => {
  return !!site.kind?.includes('functionapp')
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

export const isWindowsFunctionApp = (site: Site): boolean => isWindows(site) && isFunctionApp(site)

// The .NET site extension only injects its profiler on Dedicated (App Service) and Elastic
// Premium plans. On Consumption / Flex Consumption the extension installs but the profiler is
// never attached to the worker, so no telemetry flows. site.sku carries the plan tier name.
const UNSUPPORTED_FUNCTION_APP_SKUS = ['Dynamic', 'FlexConsumption']
export const isConsumptionPlan = (site: Site): boolean =>
  !!site.sku && UNSUPPORTED_FUNCTION_APP_SKUS.some((sku) => sku.toLowerCase() === site.sku!.toLowerCase())

export const isLinuxContainer = (site: Site): boolean => {
  if (!site.siteConfig?.linuxFxVersion) {
    return false
  }
  const linuxFxVersion = site.siteConfig.linuxFxVersion.toLowerCase()

  return (
    linuxFxVersion === 'sitecontainers' || linuxFxVersion.startsWith('docker|') || linuxFxVersion.startsWith('compose|')
  )
}

/** Sticky slot settings (in slotConfigNames) to apply to a site. */
export interface StickySlotSettings {
  resourceGroup: string
  webAppName: string
  names: string[]
}

export interface ProcessResult {
  success: boolean
  // Sticky settings to add/remove on the parent site, aggregated and written once per site.
  sticky?: StickySlotSettings
}

/** Build a sticky-settings entry, or undefined when this isn't a slot or there's nothing to pin. */
export const stickySlotSettings = (
  resourceGroup: string,
  webApp: WebApp,
  names: string[]
): StickySlotSettings | undefined =>
  webApp.slot && names.length ? {resourceGroup, webAppName: webApp.name, names} : undefined

/**
 * Collapse per-resource sticky settings into one entry per site, unioning their names.
 * slotConfigNames is a single site-level resource shared by all of a site's slots, so
 * each site must be touched with a single read-modify-write rather than once per slot.
 */
export const aggregateStickyBySite = (entries: (StickySlotSettings | undefined)[]): StickySlotSettings[] => {
  const bySite = new Map<string, StickySlotSettings>()
  for (const entry of entries) {
    if (!entry?.names.length) {
      continue
    }
    // Web App names are globally unique, so the name alone identifies the site.
    const key = entry.webAppName
    const merged = bySite.get(key) ?? {resourceGroup: entry.resourceGroup, webAppName: entry.webAppName, names: []}
    merged.names = [...new Set([...merged.names, ...entry.names])]
    bySite.set(key, merged)
  }

  return [...bySite.values()]
}

/**
 * Add or remove sticky slot settings on a site's slotConfigNames with a single
 * read-modify-write. No-op when nothing changes.
 */
export const mutateStickySlotSettings = async (
  client: WebSiteManagementClient,
  resourceGroup: string,
  webAppName: string,
  names: string[],
  mode: 'add' | 'remove',
  opts: {dryRun: boolean; dryRunPrefix: string; log: (message: string) => void}
): Promise<void> => {
  const existing: SlotConfigNamesResource = await client.webApps.listSlotConfigurationNames(resourceGroup, webAppName)
  const current = existing.appSettingNames ?? []
  const changed = mode === 'add' ? names.filter((n) => !current.includes(n)) : names.filter((n) => current.includes(n))
  if (changed.length === 0) {
    return
  }
  const appSettingNames = mode === 'add' ? [...current, ...changed] : current.filter((n) => !changed.includes(n))
  opts.log(
    mode === 'add'
      ? `${opts.dryRunPrefix}Registering ${changed.join(', ')} as sticky slot setting(s) on ${chalk.bold(webAppName)}\n`
      : `${opts.dryRunPrefix}Removing sticky slot setting(s) ${changed.join(', ')} from ${chalk.bold(webAppName)}\n`
  )
  if (!opts.dryRun) {
    await client.webApps.updateSlotConfigurationNames(resourceGroup, webAppName, {...existing, appSettingNames})
  }
}
