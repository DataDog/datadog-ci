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

export const isValidDatadogSite = (site: string): boolean => {
  return !!process.env.DD_CI_BYPASS_SITE_VALIDATION || DATADOG_SITES.includes(site.toLowerCase())
}
