import {DATADOG_SITE_US1} from '../constants'

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || DATADOG_SITE_US1

/**
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (intake: string) => {
  return `https://${intake}.${datadogSite}`
}
