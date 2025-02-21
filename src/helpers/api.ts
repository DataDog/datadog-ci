import {DATADOG_SITE_US1} from '../constants'

/**
 * Returns the current Datadog site. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getDatadogSite = () => {
  return process.env.DATADOG_SITE || process.env.DD_SITE || DATADOG_SITE_US1
}

export const getBaseApiUrl = () => {
  return `https://api.${getDatadogSite()}`
}

/**
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (intake: string) => {
  return `https://${intake}.${getDatadogSite()}`
}
