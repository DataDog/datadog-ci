import {Writable} from 'stream'

import {AxiosPromise} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  spanTags: SpanTags
  userScope: Record<string, string[]>
}

export interface EvaluationResponsePayload {
  data: {
    attributes: EvaluationResponse
  }
}

type GateStatus = 'passed' | 'failed' | 'empty'

export interface EvaluationResponse {
  status: GateStatus
  rule_evaluations: RuleEvaluation[]
}

type RuleStatus = 'passed' | 'failed' | 'no_data'

export interface RuleEvaluation {
  rule_id: string
  rule_name: string
  status: RuleStatus
  is_blocking: boolean
  failure_reason: string
  events_count: number
}

export interface APIHelper {
  evaluateGateRules(evaluateRequest: Payload, write: Writable['write']): AxiosPromise<EvaluationResponsePayload>
}
