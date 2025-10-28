import chalk from 'chalk'

import {DATADOG_SITE_US1} from '../constants'

import {renderSoftWarning} from './renderer'

/**
 * Shared constants for serverless instrumentation
 */
export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = 8126

/**
 * Regular expression for parsing environment variables in KEY=VALUE format
 */
export const ENV_VAR_REGEX = /^([\w.]+)=(.*)$/

// Type stubs for Azure SDK types (to avoid importing @azure packages)
interface AzureCredential {
  getToken(scopes: string | string[]): Promise<{token: string} | null>
}

interface AzureError {
  name?: string
}

/**
 * Ensures Azure authentication is working by attempting to get a token.
 * @param print - Function to print messages
 * @param cred - Azure credential object with getToken method
 * @returns true if authentication succeeds, false otherwise
 */
export const ensureAzureAuth = async (print: (arg: string) => void, cred: AzureCredential): Promise<boolean> => {
  try {
    await cred.getToken('https://management.azure.com/.default')
  } catch (error) {
    print(
      renderSoftWarning(
        `Failed to authenticate with Azure: ${
          (error as AzureError).name
        }\n\nPlease ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run ${chalk.bold(
          'az login'
        )} to authenticate.\n`
      )
    )

    return false
  }

  return true
}

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
 * Formats an error (usually an Azure RestError) object into a string for display.
 * @param error - Error object to format
 * @returns Formatted error string
 */
// no-dd-sa:typescript-best-practices/no-explicit-any
export const formatError = (error: any): string => {
  const errorType = error.code ?? error.name
  const errorMessage = error.details?.message ?? error.message

  return `${errorType}: ${errorMessage}`
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
  isInstanceLoggingEnabled?: boolean
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

  return envVars
}
