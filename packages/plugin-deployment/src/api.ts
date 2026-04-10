import type {
  APIHelper,
  GateEvaluationRequest,
  GateEvaluationRequestResponse,
  GateEvaluationStatusResponse,
} from './interfaces'
import type {RequestConfig, RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

import {datadogRoute} from '@datadog/datadog-ci-base/helpers/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

const requestGateEvaluation =
  (request: (args: RequestConfig) => Promise<RequestResponse<GateEvaluationRequestResponse>>) =>
  async (evaluationRequest: GateEvaluationRequest) => {
    const payload = {
      data: {
        type: 'deployment_gates_evaluation_request',
        attributes: {
          service: evaluationRequest.service,
          env: evaluationRequest.env,
          identifier: evaluationRequest.identifier,
          ...(evaluationRequest.version && {version: evaluationRequest.version}),
          ...(evaluationRequest.apm_primary_tag && {apm_primary_tag: evaluationRequest.apm_primary_tag}),
          ...(evaluationRequest.monitors_query_variable && {
            monitors_query_variable: evaluationRequest.monitors_query_variable,
          }),
        },
      },
    }

    return request({
      data: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      url: datadogRoute('/api/unstable/deployments/gates/evaluation'),
    })
  }

const getGateEvaluationResult =
  (request: (args: RequestConfig) => Promise<RequestResponse<GateEvaluationStatusResponse>>) =>
  async (evaluationId: string) => {
    return request({
      method: 'GET',
      url: datadogRoute('/api/unstable/deployments/gates/evaluation/:evaluationId', {evaluationId}),
    })
  }

export const apiConstructor = (baseUrl: string, apiKey: string, appKey: string): APIHelper => {
  const requestBuilder = getRequestBuilder({baseUrl, apiKey, appKey})

  return {
    requestGateEvaluation: requestGateEvaluation(requestBuilder),
    getGateEvaluationResult: getGateEvaluationResult(requestBuilder),
  }
}
