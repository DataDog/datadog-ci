import {DATADOG_SITE_US1} from '../constants'
import {APIHelper} from '../commands/sarif/interfaces'
import chalk from 'chalk'
import {apiConstructor} from '../commands/sarif/api'

/**
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (intake: string) => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://${intake}.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return `https://${intake}.${DATADOG_SITE_US1}`
}
