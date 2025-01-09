import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  hostname: string
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
  paths: string[]
  format: string | undefined
  flush: boolean
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): AxiosPromise<AxiosResponse>
}
