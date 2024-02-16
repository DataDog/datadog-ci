import {DATADOG_SITE_US1} from '../constants'

/**
 *  Get the site domain by reading DATADOG_SITE or DD_SITE
 *  Otherwise we go with US1 as default
 */
export const getDatadogSite = () => {
  return process.env.DATADOG_SITE || process.env.DD_SITE || DATADOG_SITE_US1
}

/**
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (intake: string) => {
  return `https://${intake}.${getDatadogSite()}`
}
