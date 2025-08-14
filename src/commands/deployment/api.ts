import type {AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {
  APIHelper,
  GateEvaluationRequest,
  GateEvaluationRequestResponse,
  GateEvaluationStatusResponse,
} from './interfaces'

const requestGateEvaluation = (
  request: (args: AxiosRequestConfig) => AxiosPromise<GateEvaluationRequestResponse>
) => async (evaluationRequest: GateEvaluationRequest) => {
  const payload = {
    data: {
      type: 'deployment_gates_evaluation_request',
      attributes: {
        service: evaluationRequest.service,
        env: evaluationRequest.env,
        identifier: evaluationRequest.identifier,
        ...(evaluationRequest.version && {version: evaluationRequest.version}),
        ...(evaluationRequest.apm_primary_tag && {apm_primary_tag: evaluationRequest.apm_primary_tag}),
        ...(evaluationRequest.monitor_variable && {monitor_variable: evaluationRequest.monitor_variable}),
      },
    },
  }

  return request({
    data: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    url: '/api/unstable/deployments/gates/evaluation',
  })
}

const getGateEvaluationResult = (
  request: (args: AxiosRequestConfig) => AxiosPromise<GateEvaluationStatusResponse>
) => async (evaluationId: string) => {
  return request({
    method: 'GET',
    url: `/api/unstable/deployments/gates/evaluation/${evaluationId}`,
  })
}

export const apiConstructor = (baseUrl: string, apiKey: string, appKey: string): APIHelper => {
  const requestBuilder = getRequestBuilder({baseUrl, apiKey, appKey})

  return {
    requestGateEvaluation: requestGateEvaluation(requestBuilder),
    getGateEvaluationResult: getGateEvaluationResult(requestBuilder),
  }
}
