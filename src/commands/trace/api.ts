import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getGitMetadata} from '../../helpers/git'
import {getUserGitMetadata} from '../../helpers/user-provided-git'
import {getRequestBuilder} from '../../helpers/utils'
import {Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const reportCustomSpan = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  customSpan: Payload,
  provider: string
) => {
  const gitSpanTags = await getGitMetadata()
  const userGitSpanTags = getUserGitMetadata()
  customSpan.tags = {
    ...gitSpanTags,
    ...userGitSpanTags,
    ...customSpan.tags,
  }

  return request({
    data: customSpan,
    headers: {
      'X-Datadog-CI-Custom-Event': provider,
    },
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    reportCustomSpan: reportCustomSpan(requestIntake),
  }
}
