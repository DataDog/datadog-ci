import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {RequestResponse} from '@datadog/datadog-ci-base/helpers/request'
import type {Writable} from 'stream'

export interface Payload {
  reportPath: string
  spanTags: SpanTags
  service: string
}

export interface APIHelper {
  uploadSarifReport(sarifReport: Payload, write: Writable['write']): Promise<RequestResponse>
}
