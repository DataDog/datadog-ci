import {getDatadogSite} from './api'

export const DEFAULT_DATADOG_SUBDOMAIN = 'app'

export const getCommonAppBaseUrl = (config?: {datadogSite?: string; subdomain?: string}): string => {
  const datadogSite = config?.datadogSite || getDatadogSite()
  const subdomain = config?.subdomain || process.env.DD_SUBDOMAIN || DEFAULT_DATADOG_SUBDOMAIN

  const datadogSiteParts = datadogSite.split('.')

  if (datadogSiteParts.length === 3) {
    if (subdomain === DEFAULT_DATADOG_SUBDOMAIN) {
      return `https://${datadogSite}/`
    }

    return `https://${subdomain}.${datadogSiteParts[1]}.${datadogSiteParts[2]}/`
  }

  return `https://${subdomain}.${datadogSite}/`
}
