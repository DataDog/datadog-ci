import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  hostname: string
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
  path: string
  format: string
}

export interface Flush {
  hostname: string
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): AxiosPromise<AxiosResponse>
  flushCodeCoverage(flush: Flush): AxiosPromise<AxiosResponse>
}
