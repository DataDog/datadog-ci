import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

import {Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const reportCustomSpan =
  (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (customSpan: Payload) => {
    return request({
      data: {
        data: {
          type: 'ci_app_custom_span',
          attributes: customSpan,
        },
      },
      maxBodyLength,
      method: 'POST',
      url: '/api/intake/ci/custom_spans',
    })
  }

export const apiConstructor = (baseUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl, apiKey})

  return {
    reportCustomSpan: reportCustomSpan(requestIntake),
  }
}
