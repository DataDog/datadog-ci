import type {AxiosPromise, AxiosResponse} from 'axios'

import {CI_ENGINES} from '@datadog/datadog-ci-base/helpers/ci'

export const SUPPORTED_PROVIDERS = [
  CI_ENGINES.GITHUB,
  CI_ENGINES.GITLAB,
  CI_ENGINES.JENKINS,
  CI_ENGINES.CIRCLECI,
  CI_ENGINES.AWSCODEPIPELINE,
  CI_ENGINES.AZURE,
  CI_ENGINES.BUILDKITE,
] as const
export type Provider = typeof SUPPORTED_PROVIDERS[number]

export interface Payload {
  ci_provider: string
  span_id: string
  command: string
  name: string
  start_time: string
  end_time: string
  error_message: string
  exit_code: number
  tags: Partial<Record<string, string>>
  measures: Partial<Record<string, number>>
}

export interface APIHelper {
  reportCustomSpan(customSpan: Payload): AxiosPromise<AxiosResponse>
}
