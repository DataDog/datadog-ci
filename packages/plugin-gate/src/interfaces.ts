import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {AxiosPromise} from 'axios'
import type {Writable} from 'stream'

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
  pull_request_sha?: string
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
