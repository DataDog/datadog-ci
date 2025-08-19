import fs from 'fs'

import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import * as t from 'typanion'

export const checkFile: (path: string) => {empty: boolean; exists: boolean} = (path: string) => {
  try {
    const stats = fs.statSync(path)
    if (stats.size === 0) {
      return {exists: true, empty: true}
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {exists: false, empty: false}
    }
    // Other kind of error
    throw error
  }

  return {exists: true, empty: false}
}

/**
 * Check if a string is a valid Datadog site.
 *
 * If the environment variable `DD_CI_BYPASS_SITE_VALIDATION` is
 * set, then it will return `true`.
 *
 * @param site an optional string.
 * @returns a boolean indicating if the provided site is valid a Datadog site.
 */
export const isValidDatadogSite = (site?: string): boolean => {
  if (site === undefined) {
    return false
  }

  return !!process.env.DD_CI_BYPASS_SITE_VALIDATION || DATADOG_SITES.includes(site.toLowerCase())
}

const renderDuplicateAPIKey = (environmentAPIKey: string) => {
  return `API keys were specified both in a configuration file and in the environment.\nThe environment API key ending in ${environmentAPIKey.slice(
    -4
  )} will be used.\n`
}

export const checkAPIKeyOverride = (
  environmentAPIKey: string | undefined,
  configFileAPIKey: string | undefined,
  stdout: {write: (message: string) => void}
): void => {
  if (configFileAPIKey && environmentAPIKey && configFileAPIKey !== environmentAPIKey) {
    stdout.write(renderDuplicateAPIKey(environmentAPIKey))
  }
}

export const isInteger = () => t.cascade(t.isNumber(), t.isInteger())
