import {SpanTags} from '../../helpers/interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL} from '../../helpers/tags'

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    return `https://cireport-intake.${process.env.DATADOG_SITE || process.env.DD_SITE}`
  }

  return 'https://cireport-intake.datadoghq.com'
}

export const getBaseUrl = () => {
  if (process.env.DATADOG_SITE || process.env.DD_SITE) {
    let site = process.env.DATADOG_SITE || process.env.DD_SITE
    if (site === 'datadoghq.com') {
      site = 'app.datadoghq.com'
    } else if (site === 'datad0g.com') {
      site = 'dd.datad0g.com'
    }

    return `https://${site}`
  }

  return 'https://app.datadoghq.com'
}

export const getTestRunsUrl = (spanTags: SpanTags): string => {
  if (!spanTags[CI_PIPELINE_URL] && !spanTags[CI_JOB_URL]) {
    return ''
  }

  let query = ''
  if (spanTags[CI_PIPELINE_URL]) {
    query += ` @ci.pipeline.url:"${spanTags[CI_PIPELINE_URL]}"`
  }
  if (spanTags[CI_JOB_URL]) {
    query += ` @ci.job.url:"${spanTags[CI_JOB_URL]}"`
  }

  return `${getBaseUrl()}/ci/test-runs?query=${encodeURIComponent(query)}`
}
