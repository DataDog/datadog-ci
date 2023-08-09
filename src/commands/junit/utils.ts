import {lstatSync} from 'fs'

import {getCommonAppBaseURL} from '../../helpers/app'
import {SpanTags} from '../../helpers/interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_BRANCH, GIT_REPOSITORY_URL, GIT_SHA} from '../../helpers/tags'

export const getBaseUrl = () => {
  const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
  const subdomain = process.env.DD_SUBDOMAIN || ''

  return getCommonAppBaseURL(site, subdomain)
}

export const getTestRunsUrl = (spanTags: SpanTags): string => {
  if (!spanTags[CI_PIPELINE_URL] && !spanTags[CI_JOB_URL]) {
    return ''
  }

  let query = ''
  if (spanTags[CI_JOB_URL]) {
    query += ` @ci.job.url:"${spanTags[CI_JOB_URL]}"`
  } else if (spanTags[CI_PIPELINE_URL]) {
    query += ` @ci.pipeline.url:"${spanTags[CI_PIPELINE_URL]}"`
  }

  return `${getBaseUrl()}ci/test-runs?query=${encodeURIComponent(query)}`
}

export const getTestCommitRedirectURL = (spanTags: SpanTags, service?: string, env?: string): string => {
  if (!spanTags[GIT_REPOSITORY_URL] || !spanTags[GIT_BRANCH] || !spanTags[GIT_SHA] || !service) {
    return ''
  }

  const encodedRepoUrl = encodeURIComponent(`${spanTags[GIT_REPOSITORY_URL]}`)
  const encodedService = encodeURIComponent(service)
  const encodedBranch = encodeURIComponent(`${spanTags[GIT_BRANCH]}`)
  const commitSha = `${spanTags[GIT_SHA]}`

  let url = `${getBaseUrl()}ci/redirect/tests/${encodedRepoUrl}/-/${encodedService}/-/${encodedBranch}/-/${commitSha}`
  if (env) {
    url += `?env=${encodeURIComponent(env)}`
  }

  return url
}

export const isFile = (path: string) => {
  try {
    return lstatSync(path).isFile()
  } catch (e) {
    return false
  }
}
