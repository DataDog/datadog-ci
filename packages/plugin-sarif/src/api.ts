import fs from 'fs'
import {createGzip} from 'zlib'

import type {Payload} from './interfaces'
import type {RequestConfig, RequestResponse} from '@datadog/datadog-ci-base/helpers/request'
import type {Writable} from 'stream'
import type {v4 as UUIDv4} from 'uuid'

import {datadogRoute} from '@datadog/datadog-ci-base/helpers/request/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'

import {renderUpload} from './renderer'

export const uploadSarifReport =
  (request: (args: RequestConfig) => Promise<RequestResponse>, uuidv4: typeof UUIDv4) =>
  async (sarifReport: Payload, write: Writable['write']) => {
    const form = new FormData()
    write(renderUpload(sarifReport))

    const metadata: Record<string, any> = {
      service: sarifReport.service,
      ...sarifReport.spanTags,
      event_type: 'static_analysis',
      event_format_name: 'sarif',
      event_format_version: '2.1.0',
    }

    form.append('event', JSON.stringify(metadata), {filename: 'event.json'})

    form.append('sarif_report_file', fs.createReadStream(sarifReport.reportPath).pipe(createGzip()), {
      filename: `${uuidv4()}.sarif.gz`,
    })

    return request({
      data: form,
      headers: form.getHeaders(),
      method: 'POST',
      url: datadogRoute('/api/v2/cicodescan'),
    })
  }

export const apiConstructor = (baseIntakeUrl: string, apiKey: string, uuidv4: typeof UUIDv4) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadSarifReport: uploadSarifReport(requestIntake, uuidv4),
  }
}
