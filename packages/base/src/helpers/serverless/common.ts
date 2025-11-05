import {DATADOG_SITE_US1} from '../../constants'

/**
 * Shared constants for serverless instrumentation
 */
export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = 8126
export const DEFAULT_SIDECAR_NAME = 'datadog-sidecar'
export const DEFAULT_VOLUME_NAME = 'shared-volume'
export const DEFAULT_VOLUME_PATH = '/shared-volume'
export const DEFAULT_LOGS_PATH = '/shared-volume/logs/*.log'

/**
 * Regular expression for parsing environment variables in KEY=VALUE format
 */
export const ENV_VAR_REGEX = /^([\w.]+)=(.*)$/

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
