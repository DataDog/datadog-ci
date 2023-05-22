import {Writable} from 'stream'

import {AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {EvaluationResponsePayload, Payload} from './interfaces'

export const evaluateGateRules = (
  request: (args: AxiosRequestConfig) => AxiosPromise<EvaluationResponsePayload>
) => async (evaluateRequest: Payload, write: Writable['write']) => {
  const payload = JSON.stringify({
    data: {
      type: 'gate_evaluation',
      attributes: {
        tags: evaluateRequest.spanTags,
      },
    },
  })

  return request({
    data: payload,
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: '/api/v2/quality-gates/evaluate',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string, appKey: string) => {
  const serviceRequest = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey, appKey})

  return {
    evaluateGateRules: evaluateGateRules(serviceRequest),
  }
}
