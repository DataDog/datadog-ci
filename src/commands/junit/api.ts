import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import {Writable} from 'stream'

import {getRequestBuilder} from '../../helpers/utils'
import {Payload} from './interfaces'
import {renderUpload} from './renderer'

import {CI_JOB_URL, CI_PIPELINE_URL, GIT_SHA} from '../../helpers/tags'

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
    fileName = jUnitXML.xmlPath.split('/').slice(-1)[0].replace('.xml', '')
  } catch (e) {
    fileName = 'default_file_name'
  }

  const spanTags = {
    service: jUnitXML.service,
    ...jUnitXML.spanTags,
  }
  form.append('message', JSON.stringify(spanTags))

  let uniqueFileName = `${fileName}-${jUnitXML.service}-${spanTags[GIT_SHA]}`

  if (spanTags[CI_PIPELINE_URL]) {
    uniqueFileName = `${uniqueFileName}-${spanTags[CI_PIPELINE_URL]}`
  }
  if (spanTags[CI_JOB_URL]) {
    uniqueFileName = `${uniqueFileName}-${spanTags[CI_JOB_URL]}`
  }

  form.append('junit_xml_report_file', fs.createReadStream(jUnitXML.xmlPath), {filename: `${uniqueFileName}.xml`})

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadJUnitXML: uploadJUnitXML(requestIntake),
  }
}
