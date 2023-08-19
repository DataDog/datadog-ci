import type {AxiosPromise, AxiosResponse} from 'axios'
import type {Writable} from 'stream'

import type {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  reportPath: string
  spanTags: SpanTags
  service: string
}

export interface APIHelper {
  uploadSarifReport(sarifReport: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
