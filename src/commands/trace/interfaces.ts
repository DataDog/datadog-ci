import {AxiosPromise, AxiosResponse} from 'axios'

export const CIRCLECI = 'circleci'

export const SUPPORTED_PROVIDERS = [CIRCLECI] as const
export type Provider = typeof SUPPORTED_PROVIDERS[number]

export interface Payload {
  command: string
  custom: {
    id: string
    parent_id?: string
  }
  data: Record<string, string>
  end_time: string
  is_error: boolean
  name: string
  start_time: string
  tags: Partial<Record<string, string>>
}

export interface APIHelper {
  reportCustomSpan(customSpan: Payload, provider: Provider): AxiosPromise<AxiosResponse>
}
