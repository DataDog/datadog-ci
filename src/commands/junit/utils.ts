import {getBaseUrl} from '../../helpers/app'
import {SpanTags} from '../../helpers/interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_BRANCH, GIT_REPOSITORY_URL, GIT_SHA} from '../../helpers/tags'

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

export const getTestRunsUrl = (spanTags: SpanTags, queryPrefix = ''): string => {
  const path = getTestRunsUrlPath(spanTags, queryPrefix)

  return path ? `${getBaseUrl()}${path}` : ''
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
