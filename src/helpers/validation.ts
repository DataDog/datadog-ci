import fs from 'fs'

import {DATADOG_SITES} from '../constants'

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
