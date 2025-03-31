import fs from 'fs'
import {Writable} from 'stream'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'
import {v4 as uuidv4} from 'uuid'

import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const uploadSarifReport = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  sarifReport: Payload,
  write: Writable['write']
) => {
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
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/cicodescan',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadSarifReport: uploadSarifReport(requestIntake),
  }
}
