import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  hostname: string
  hostnameOverride?: string
  logsEnabled: boolean
  service: string
  spanTags: SpanTags
  xmlPath: string
}

export interface APIHelper {
  uploadJUnitXML(jUnitXML: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
