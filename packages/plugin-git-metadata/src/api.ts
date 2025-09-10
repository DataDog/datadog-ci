export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'

export const apiHost = 'api.' + datadogSite

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
  }

  return 'https://sourcemap-intake.' + datadogSite
}
