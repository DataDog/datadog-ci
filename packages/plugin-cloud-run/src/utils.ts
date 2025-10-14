import type {IService} from './types'

import {ServicesClient} from '@google-cloud/run'
import chalk from 'chalk'
import {GoogleAuth} from 'google-auth-library'
import {diff} from 'jest-diff'

import {withSpinner} from './renderer'

/**
 * Check if the user is authenticated with GCP.
 * @returns true if the user is authenticated, false otherwise
 */
export const checkAuthentication = async () => {

  const auth = new GoogleAuth()
  try {
    await auth.getApplicationDefault()

    return true
  } catch (_) {
    return false
  }
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
 * TODO(@nhulston): update Lambda and AAS instrument to show this diff
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

export const fetchServiceConfigs = async (
  client: ServicesClient,
  project: string,
  region: string,
  services: string[]
) => {
  const existingServiceConfigs: IService[] = []
  for (const serviceName of services) {
    const servicePath = client.servicePath(project, region, serviceName)

    const existingService = await withSpinner(
      `Fetching configuration for ${chalk.bold(serviceName)}...`,
      async () => {
        try {
          const [serv] = await client.getService({name: servicePath})

          return serv
        } catch (error) {
          throw new Error(
            `Service ${serviceName} not found in project ${project}, region ${region}.\n\nNo services were instrumented.\n`
          )
        }
      },
      `Fetched service configuration for ${chalk.bold(serviceName)}`
    )
    existingServiceConfigs.push(existingService)
  }

  return existingServiceConfigs
}
