import {AxiosPromise, AxiosResponse} from 'axios'

export interface Payload {
  data: Record<string, string>
  duration: number
  id: string
  is_error: boolean
  parent_id?: string
  tags: Partial<Record<string, string>>
}

export interface APIHelper {
  reportCustomSpan(customSpan: Payload, provider: string): AxiosPromise<AxiosResponse>
}
