import {Writable} from 'stream'

import {AxiosPromise} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  requestId: string
  startTimeMs: number
  spanTags: SpanTags
  userScope: Record<string, string[]>
  options: PayloadOptions
}

export interface PayloadOptions {
  dryRun: boolean
  noWait: boolean
  isLastRetry?: boolean
}

export interface EvaluationResponsePayload {
  data: {
    attributes: EvaluationResponse
  }
}

export interface EvaluationResponse {
  status: string
  rule_evaluations: RuleEvaluation[]
  metadata?: {
    wait_time_ms: number
  }
}

export interface RuleEvaluation {
  rule_id: string
  rule_name: string
  status: string
  is_blocking: boolean
  failure_reason: string
  details_url: string
}

export interface APIHelper {
  evaluateGateRules(evaluateRequest: Payload, write: Writable['write']): AxiosPromise<EvaluationResponsePayload>
}
