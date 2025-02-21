import {DATADOG_SITE_US1} from '../constants'

export const getDatadogApiKeyFromEnv = (): string | undefined => {
  return process.env.DATADOG_API_KEY || process.env.DD_API_KEY
}

export const getDatadogAppKeyFromEnv = (): string | undefined => {
  return process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY
}

/**
 * Returns the current Datadog site. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getDatadogSite = (config?: {datadogSite?: string}): string => {
  return process.env.DATADOG_SITE || process.env.DD_SITE || config?.datadogSite || DATADOG_SITE_US1
}

/**
 * Returns the base API URL for the current Datadog site. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseApiUrl = (config?: {datadogSite?: string}): string => {
  return `https://api.${getDatadogSite(config)}`
}
