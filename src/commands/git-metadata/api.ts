export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'

export const apiHost = 'api.' + datadogSite
