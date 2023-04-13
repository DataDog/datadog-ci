import fs from 'fs'
import path from 'path'
import {Writable} from 'stream'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'

import {getSafeFileName} from '../../helpers/file'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_SHA} from '../../helpers/tags'
import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://cireport-intake.${datadogSite}`
export const apiUrl = 'https://api.' + datadogSite

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

  const metadata: Record<string, any> = {
    service: jUnitXML.service,
    ...jUnitXML.spanTags,
    '_dd.cireport_version': '2',
    '_dd.hostname': jUnitXML.hostname,
  }

  if (jUnitXML.logsEnabled) {
    metadata['_dd.junitxml_logs'] = true
  }

  if (jUnitXML.xpathTags) {
    metadata['_dd.junitxml_xpath_tags'] = jUnitXML.xpathTags
  }

  form.append('event', JSON.stringify(metadata), {filename: 'event.json'})

  let uniqueFileName = `${fileName}-${jUnitXML.service}-${metadata[GIT_SHA]}`

  if (metadata[CI_PIPELINE_URL]) {
    uniqueFileName = `${uniqueFileName}-${metadata[CI_PIPELINE_URL]}`
  }
  if (metadata[CI_JOB_URL]) {
    uniqueFileName = `${uniqueFileName}-${metadata[CI_JOB_URL]}`
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
