import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

export interface Payload {
  hostname: string
  logsEnabled: boolean
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
  reportTags: Record<string, string>
  reportMeasures: Record<string, number>
  xmlPath: string
  xpathTags?: Record<string, string>
}

export interface APIHelper {
  uploadJUnitXML(jUnitXML: Payload): Promise<RequestResponse>
}
