import type {AxiosPromise} from 'axios'

export interface GateEvaluationRequest {
  service: string
  env: string
  identifier?: string
  version?: string
  apm_primary_tag?: string
  monitors_query_variable?: string
}

export interface GateEvaluationRequestResponse {
  data: {
    id: string
    type: string
    attributes: {
      evaluation_id: string
    }
  }
}

export interface GateEvaluationStatusResponse {
  data: {
    id: string
    type: string
    attributes: {
      dry_run: boolean
      evaluation_id: string
      evaluation_url: string
      gate_id: string
      gate_status: 'pass' | 'fail' | 'in_progress'
      rules: [
        {
          name: string
          status: 'pass' | 'fail' | 'in_progress'
          reason: string
          dry_run: boolean
        },
      ]
    }
  }
}

export interface APIHelper {
  requestGateEvaluation(request: GateEvaluationRequest): AxiosPromise<GateEvaluationRequestResponse>
  getGateEvaluationResult(evaluationId: string): AxiosPromise<GateEvaluationStatusResponse>
}
