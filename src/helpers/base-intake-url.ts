import {getDatadogSite} from './api'

/**
 * Get the base intake URL for a service. If the `DD_SITE` or `DATADOG_SITE` environment
 * variables are not defined, use the default site (US1).
 */
export const getBaseIntakeUrl = (
  intake: string,
  config?: {datadogSite?: string},
  environment?: {datadogSite?: string}
): string => {
  const intakeEnvOverride = environment && environment.datadogSite
  if (intakeEnvOverride) {
    return intakeEnvOverride
  }

  return `https://${intake}.${getDatadogSite(config)}`
}

export const getBaseSourcemapIntakeUrl = (datadogSite?: string) => {
  return getBaseIntakeUrl(
    'sourcemap-intake',
    {
      datadogSite,
    },
    {
      datadogSite: process.env['DATADOG_SOURCEMAP_INTAKE_URL'],
    }
  )
}
