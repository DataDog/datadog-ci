import {AxiosPromise, AxiosResponse} from 'axios'

export interface CustomIDs {
  id: string
  parent_id?: string
}

export interface Payload {
  custom: CustomIDs
  data: Record<string, string>
  end_time: string
  is_error: boolean
  name: string
  start_time: string
  tags: Partial<Record<string, string>>
}

export interface APIHelper {
  reportCustomSpan(customSpan: Payload, provider: string): AxiosPromise<AxiosResponse>
}
