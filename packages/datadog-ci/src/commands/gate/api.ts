import {Writable} from 'stream'

import type {AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

import {EvaluationResponsePayload, Payload} from './interfaces'

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
          is_last_retry: evaluateRequest.options.isLastRetry,
          pull_request_sha: evaluateRequest.options.pull_request_sha,
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
