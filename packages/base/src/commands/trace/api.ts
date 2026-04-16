import type {Payload} from './interfaces'

import type {RequestBuilder} from '../../helpers/interfaces'
import {getRequestBuilder} from '../../helpers/utils'

export const reportCustomSpan = (request: RequestBuilder) => async (customSpan: Payload) => {
  return request({
    data: {
      data: {
        type: 'ci_app_custom_span',
        attributes: customSpan,
      },
    },
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
