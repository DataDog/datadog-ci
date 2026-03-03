import {DATADOG_SITE_US1} from '../constants'

/**
 * Read the Datadog site from `DATADOG_SITE` / `DD_SITE` env vars.
 * Returns `undefined` when neither is set.
 */
export const getDatadogSiteFromEnv = (): string | undefined => process.env.DATADOG_SITE || process.env.DD_SITE

/**
 * Single source of truth for Datadog site resolution. If `site` is passed, returns it.
 * Otherwise reads from `DATADOG_SITE` / `DD_SITE` env vars with US1 fallback.
 */
export const getDatadogSite = (site?: string): string => site || getDatadogSiteFromEnv() || DATADOG_SITE_US1

/**
 * Build `https://{subdomain}.{site}` with optional env var override.
 */
export const getIntakeUrl = (
  subdomain: string,
  options?: {
    overrideEnvVar?: string
    site?: string
  }
): string => {
  if (options?.overrideEnvVar) {
    const override = process.env[options.overrideEnvVar]
    if (override) {
      return override
    }
  }

  return `https://${subdomain}.${getDatadogSite(options?.site)}`
}

/**
 * Build the full API URL (`https://api.{site}`) for a given site.
 */
export const getApiUrl = (site?: string): string => `https://api.${getDatadogSite(site)}`

/**
 * @deprecated Use {@link getIntakeUrl} instead.
 *
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (intake: string) => getIntakeUrl(intake)
