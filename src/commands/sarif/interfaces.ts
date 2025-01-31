import {Writable} from 'stream'

import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  reportPath: string
  spanTags: SpanTags
}

export interface APIHelper {
  uploadSarifReport(sarifReport: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
