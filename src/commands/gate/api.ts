import type {EvaluationResponsePayload, Payload} from './interfaces'
import type {AxiosPromise, AxiosRequestConfig} from 'axios'
import type {Writable} from 'stream'

import {getRequestBuilder} from '../../helpers/utils'

export const evaluateGateRules = (
  request: (args: AxiosRequestConfig) => AxiosPromise<EvaluationResponsePayload>
) => async (evaluateRequest: Payload, write: Writable['write']) => {
  const payload = JSON.stringify({
    data: {
      id: evaluateRequest.requestId,
      type: 'gate_evaluation',
      attributes: {
        tags: evaluateRequest.spanTags,
        user_scope: evaluateRequest.userScope,
        start_time_ms: evaluateRequest.startTimeMs,
        options: {
          no_wait: evaluateRequest.options.noWait,
          dry_run: evaluateRequest.options.dryRun,
        },
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
