export const DEFAULT_DATADOG_SUBDOMAIN = 'app'

export const getBaseUrl = () => {
  const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
  const subdomain = process.env.DD_SUBDOMAIN || ''

  return getCommonAppBaseURL(site, subdomain)
}

export const getCommonAppBaseURL = (datadogSite: string, subdomain: string) => {
  const validSubdomain = subdomain || DEFAULT_DATADOG_SUBDOMAIN
  const datadogSiteParts = datadogSite.split('.')

  if (datadogSiteParts.length === 3) {
    if (validSubdomain === DEFAULT_DATADOG_SUBDOMAIN) {
      return `https://${datadogSite}/`
    }

    return `https://${validSubdomain}.${datadogSiteParts[1]}.${datadogSiteParts[2]}/`
  }

  return `https://${validSubdomain}.${datadogSite}/`
}
