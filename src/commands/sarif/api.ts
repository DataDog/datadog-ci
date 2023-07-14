import fs from 'fs'
import path from 'path'
import {Writable} from 'stream'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'

import {getSafeFilename} from '../../helpers/file'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_SHA} from '../../helpers/tags'
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

  let fileName
  try {
    fileName = path.parse(sarifReport.reportPath).name
  } catch (e) {
    fileName = 'default_file_name'
  }

  const metadata: Record<string, any> = {
    service: sarifReport.service,
    ...sarifReport.spanTags,
    event_type: 'static_analysis',
    event_format_name: 'sarif',
    event_format_version: '2.1.0',
  }

  form.append('event', JSON.stringify(metadata), {filename: 'event.json'})

  let uniqueFileName = `${fileName}-${sarifReport.service}-${metadata[GIT_SHA]}`

  if (metadata[CI_PIPELINE_URL]) {
    uniqueFileName = `${uniqueFileName}-${metadata[CI_PIPELINE_URL]}`
  }
  if (metadata[CI_JOB_URL]) {
    uniqueFileName = `${uniqueFileName}-${metadata[CI_JOB_URL]}`
  }

  form.append('sarif_report_file', fs.createReadStream(sarifReport.reportPath).pipe(createGzip()), {
    filename: `${getSafeFilename(uniqueFileName)}.sarif.gz`,
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
