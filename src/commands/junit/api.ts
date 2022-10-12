import fs from 'fs'
import path from 'path'
import {Writable} from 'stream'
import {createGzip} from 'zlib'
import FormData from 'form-data'
import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {CI_JOB_URL, CI_PIPELINE_URL, GIT_SHA} from '../../helpers/tags'
import {renderUpload} from './renderer'
import {Payload} from './interfaces'

// We need a unique file name so we use span tags like the pipeline URL,
// which can contain dots and other unsafe characters for filenames.
// We filter them out here.
export const getSafeFileName = (unsafeFileName: string) => unsafeFileName.replace(/[^a-z0-9]/gi, '_')

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const uploadJUnitXML = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  jUnitXML: Payload,
  write: Writable['write']
) => {
  const form = new FormData()
  write(renderUpload(jUnitXML))

  let fileName
  try {
    fileName = path.parse(jUnitXML.xmlPath).name
  } catch (e) {
    fileName = 'default_file_name'
  }

  const spanTags: Record<string, string | undefined> = {
    service: jUnitXML.service,
    ...jUnitXML.spanTags,
    '_dd.cireport_version': '2',
    '_dd.hostname': jUnitXML.hostname,
  }

  if (jUnitXML.logsEnabled) {
    spanTags['_dd.junitxml_logs'] = 'true'
  }

  form.append('event', JSON.stringify(spanTags), {filename: 'event.json'})

  let uniqueFileName = `${fileName}-${jUnitXML.service}-${spanTags[GIT_SHA]}`

  if (spanTags[CI_PIPELINE_URL]) {
    uniqueFileName = `${uniqueFileName}-${spanTags[CI_PIPELINE_URL]}`
  }
  if (spanTags[CI_JOB_URL]) {
    uniqueFileName = `${uniqueFileName}-${spanTags[CI_JOB_URL]}`
  }

  form.append('junit_xml_report_file', fs.createReadStream(jUnitXML.xmlPath).pipe(createGzip()), {
    filename: `${getSafeFileName(uniqueFileName)}.xml.gz`,
  })

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/cireport',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadJUnitXML: uploadJUnitXML(requestIntake),
  }
}
