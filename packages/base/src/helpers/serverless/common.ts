import chalk from 'chalk'
import {diff} from 'jest-diff'

import {
  HEALTH_PORT_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  SITE_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  LOGS_PATH_ENV_VAR,
  ENV_VAR_REGEX,
} from './constants'
/**
 * Parses environment variables from array format (KEY=VALUE) to object format.
 * @param envVars - Array of environment variables in KEY=VALUE format
 * @returns Object with parsed environment variables
 */
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

/**
 * Collects all items from a paged async iterator into an array.
 * @param it - Paged async iterator
 * @returns Array of all items
 */
export const collectAsyncIterator = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const arr = []
  for await (const x of it) {
    arr.push(x)
  }

  return arr
}

/**
 * Common configuration options for serverless resources
 */
export interface ServerlessConfigOptions {
  service?: string
  environment?: string
  version?: string
  logPath?: string
  extraTags?: string
  envVars?: string[]
}

/**
 * Builds base environment variables for serverless instrumentation.
 * @param config - Configuration options
 * @returns Base environment variables object
 */
export const getBaseEnvVars = (config: ServerlessConfigOptions): Record<string, string> => {
  const envVars: Record<string, string> = {
    DD_API_KEY: process.env.DD_API_KEY!,
    DD_SITE: process.env.DD_SITE ?? DATADOG_SITE_US1,
    DD_SERVICE: config.service!,
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

  return envVars
}
/**
 * Recursively sort object keys to ensure consistent ordering
 */
const sortObjectKeys = (obj: any): any => {
  if (!obj) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys)
  }

  if (typeof obj === 'object') {
    const sorted: any = {}
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = sortObjectKeys(obj[key])
      })

    return sorted
  }

  return obj
}
/**
 * Obfuscate sensitive values in a line if it contains a key with "_KEY"
 */
const obfuscateSensitiveValues = (line: string): string => {
  // Match hex strings of 16, 32, or 64 characters (common API key/token lengths)
  return line
    .replace(/("[0-9a-fA-F]{16}"|"[0-9a-fA-F]{32}"|"[0-9a-fA-F]{64}")/g, '"***"')
    .replace(/('[0-9a-fA-F]{16}'|'[0-9a-fA-F]{32}'|'[0-9a-fA-F]{64}')/g, "'***'")
}
/**
 * Generate a git diff-style comparison between two configurations
 * @param original The original configuration object
 * @param updated The updated configuration object
 * @returns A formatted diff string with colors
 */

export const generateConfigDiff = (original: any, updated: any): string => {
  // Sort keys consistently before comparison
  const sortedOriginal = sortObjectKeys(original)
  const sortedUpdated = sortObjectKeys(updated)

  const originalJson = JSON.stringify(sortedOriginal, undefined, 2)
  const updatedJson = JSON.stringify(sortedUpdated, undefined, 2)

  const obfuscatedOriginal = originalJson.split('\n').map(obfuscateSensitiveValues).join('\n')
  const obfuscatedUpdated = updatedJson.split('\n').map(obfuscateSensitiveValues).join('\n')

  const configDiff = diff(obfuscatedOriginal, obfuscatedUpdated, {
    aColor: chalk.red,
    bColor: chalk.green,
    omitAnnotationLines: true,
  })
  if (!configDiff || configDiff.includes('no visual difference')) {
    return chalk.gray('No changes detected.')
  }

  return configDiff
}

export const byName = <T extends FullyOptional<{name: string}>>(xs: T[]): Record<string, T> => {
  return Object.fromEntries(xs.filter((x) => x.name).map((x) => [x.name, x]))
}

const DEFAULT_HEALTH_CHECK_PORT = 5555

// GCP makes all their types like this so we need to allow it
type FullyOptional<T> = {
  [K in keyof T]?: T[K] | null | undefined
}

type EnvVar = FullyOptional<{name: string; value: string}>

const DEFAULT_ENV_VARS_BY_NAME: Record<string, EnvVar> = byName([
  {name: SITE_ENV_VAR, value: DATADOG_SITE_US1},
  {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
  {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
  {name: HEALTH_PORT_ENV_VAR, value: DEFAULT_HEALTH_CHECK_PORT.toString()},
])

type Container = FullyOptional<{
  name: string
  env: EnvVar[]
  volumeMounts: Volume[]
}>
type Volume = FullyOptional<{
  mountName: string
  name: string
  mountPath: string
}>

type AppTemplate = FullyOptional<{
  containers: Container[]
  volumes: Volume[]
}>

/**
 * Given the configuration, an app template, the base sidecar configuration, and base shared volume,
 */
export const createInstrumentedTemplate = (
  config: ServerlessConfigOptions,
  template: AppTemplate,
  baseSidecar: Container,
  sharedVolume: Volume,
  sharedVolumeOptions: any,
  volumeNameKey: 'name' | 'mountName',
  envVarsByName: Record<string, EnvVar>
): AppTemplate => {
  const containers = template.containers || []
  const volumes = template.volumes || []

  const existingSidecarContainer = containers.find((c) => c.name === baseSidecar.name)
  const newSidecarContainer: Container = {
    ...baseSidecar,
    env: Object.values({...byName(baseSidecar.env ?? []), ...envVarsByName}),
    volumeMounts: config.isInstanceLoggingEnabled ? [sharedVolume] : [],
  }

  // Update all app containers to add volume mounts and env vars if they don't have them
  const updatedContainers: Container[] = containers.map((container) => {
    if (container.name === baseSidecar.name) {
      return newSidecarContainer
    }

    const existingVolumeMounts = container.volumeMounts || []
    const hasSharedVolumeMount = existingVolumeMounts.some(
      (mount) => mount[volumeNameKey] === sharedVolume[volumeNameKey]
    )

    return {
      ...container,
      volumeMounts: hasSharedVolumeMount ? existingVolumeMounts : [...existingVolumeMounts, sharedVolume],
      env: Object.values({
        ...DEFAULT_ENV_VARS_BY_NAME, // Add default vars which can be overridden
        ...byName(container.env ?? []), // Then add existing env vars
        ...envVarsByName, // Finally override with any env vars specified in the CLI
      }),
    }
  })

  // Add sidecar if it doesn't exist
  if (!existingSidecarContainer) {
    updatedContainers.push(newSidecarContainer)
  }

  // Add shared volume if it doesn't exist
  const hasSharedVolume = volumes.some((volume) => volume[volumeNameKey] === sharedVolume[volumeNameKey])
  const updatedVolumes = hasSharedVolume
    ? volumes
    : [...volumes, {name: sharedVolume[volumeNameKey], ...sharedVolumeOptions}]

  return {
    ...template,
    containers: updatedContainers,
    volumes: updatedVolumes,
  }
}
