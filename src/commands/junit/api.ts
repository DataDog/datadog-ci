import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import {Writable} from 'stream'
import {createGzip} from 'zlib'

import {getRequestBuilder} from '../../helpers/utils'
import {Payload} from './interfaces'
import {renderUpload} from './renderer'

import {CI_JOB_URL, CI_PIPELINE_URL, GIT_SHA} from '../../helpers/tags'

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

  const spanTags = {
    service: jUnitXML.service,
    ...jUnitXML.spanTags,
    '_dd.cireport': {type: 'junitxml', version: 2},
  }
  form.append('message', JSON.stringify(spanTags))

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
    url: 'v1/input',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadJUnitXML: uploadJUnitXML(requestIntake),
  }
}
