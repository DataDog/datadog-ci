import {getBaseUrl, getTestRunsUrlPath} from '@datadog/datadog-ci-base/helpers/app'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {GIT_BRANCH, GIT_REPOSITORY_URL, GIT_SHA} from '@datadog/datadog-ci-base/helpers/tags'

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
