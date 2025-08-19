import {SpanTags} from './interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL} from './tags'

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

export const getTestRunsUrlPath = (spanTags: SpanTags, queryPrefix = ''): string => {
  if (!spanTags[CI_PIPELINE_URL] && !spanTags[CI_JOB_URL]) {
    return ''
  }

  let query = queryPrefix
  if (spanTags[CI_JOB_URL]) {
    query += ` @ci.job.url:"${spanTags[CI_JOB_URL]}"`
  } else if (spanTags[CI_PIPELINE_URL]) {
    query += ` @ci.pipeline.url:"${spanTags[CI_PIPELINE_URL]}"`
  }

  return `ci/test-runs?query=${encodeURIComponent(query)}`
}
