import {Writable} from 'stream'

import {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  hostname: string
  logsEnabled: boolean
  service: string
  spanTags: SpanTags
  xmlPath: string
  xpathTags?: Record<string, string>
}

export interface APIHelper {
  uploadJUnitXML(jUnitXML: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
