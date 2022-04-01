import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  service: string
  spanTags: SpanTags
  xmlPath: string
  logsEnabled: boolean
}

export interface APIHelper {
  uploadJUnitXML(jUnitXML: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
