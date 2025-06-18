import {Writable} from 'stream'

import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '@datadog/datadog-ci-core/helpers/interfaces'

export interface Payload {
  reportPath: string
  spanTags: SpanTags
  service: string
}

export interface APIHelper {
  uploadSarifReport(sarifReport: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
