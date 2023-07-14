import {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

export interface Payload {
  hostname: string
  logsEnabled: boolean
  spanTags: SpanTags
  customTags: Record<string, string>
  customMetrics: Record<string, number>
  reportTags: Record<string, string>
  reportMetrics: Record<string, number>
  xmlPath: string
  xpathTags?: Record<string, string>
}

export interface APIHelper {
  uploadJUnitXML(jUnitXML: Payload): AxiosPromise<AxiosResponse>
}
