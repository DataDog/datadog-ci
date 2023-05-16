import {Writable} from 'stream'

import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'

export const evaluateGateRules = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  evaluateRequest: Payload,
  write: Writable['write']
) => {
  // Converting the payload to the format expected from Rapid
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
