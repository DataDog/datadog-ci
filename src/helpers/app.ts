const DEFAULT_SUBDOMAIN = 'app';

export const getCommonAppBaseURL = (datadogSite: string, subdomain: string) => {
  const validSubdomain = subdomain || DEFAULT_SUBDOMAIN
  const datadogSiteParts = datadogSite.split('.')

  if (datadogSiteParts.length === 3) {
    if (validSubdomain === DEFAULT_SUBDOMAIN) {
      return `https://${datadogSite}/`
    }

    return `https://${validSubdomain}.${datadogSiteParts[1]}.${datadogSiteParts[2]}/`
  }

  return `https://${validSubdomain}.${datadogSite}/`
}
