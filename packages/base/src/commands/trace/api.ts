import type {Payload} from './interfaces'
import type {RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'

import {datadogRoute} from '@datadog/datadog-ci-base/helpers/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

export const reportCustomSpan = (request: RequestBuilder) => async (customSpan: Payload) => {
  return request({
    data: {
      data: {
        type: 'ci_app_custom_span',
        attributes: customSpan,
      },
    },
    method: 'POST',
    url: datadogRoute('/api/intake/ci/custom_spans'),
  })
}

export const apiConstructor = (baseUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl, apiKey})

  return {
    reportCustomSpan: reportCustomSpan(requestIntake),
  }
}
