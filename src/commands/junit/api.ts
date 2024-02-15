import fs from 'fs'
import path from 'path'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'
import {v4 as uuidv4} from 'uuid'

import {getDatadogSite} from '../../helpers/api'
import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const datadogSite = getDatadogSite()

export const intakeUrl = `https://cireport-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadJUnitXML = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  jUnitXML: Payload
) => {
  const form = new FormData()

  let fileName
  try {
    fileName = path.parse(jUnitXML.xmlPath).name
  } catch (e) {
    fileName = 'default_file_name'
  }

  const reportTagsAndMetrics: Record<string, any> = {
    tags: jUnitXML.reportTags,
    metrics: jUnitXML.reportMeasures, // We can't change `metrics` to `measures` because the backend only accepts `metrics`.
  }

  const custom: Record<string, any> = {
    metadata: jUnitXML.spanTags,
    tags: jUnitXML.customTags,
    metrics: jUnitXML.customMeasures,
    session: reportTagsAndMetrics,
    '_dd.cireport_version': '3',
    '_dd.hostname': jUnitXML.hostname,
    '_dd.report_name': fileName,
  }

  if (jUnitXML.logsEnabled) {
    custom['_dd.junitxml_logs'] = true
  }

  if (jUnitXML.xpathTags) {
    custom['_dd.junitxml_xpath_tags'] = jUnitXML.xpathTags
  }

  form.append('event', JSON.stringify(custom), {filename: 'event.json'})

  form.append('junit_xml_report_file', fs.createReadStream(jUnitXML.xmlPath).pipe(createGzip()), {
    filename: `${uuidv4()}.xml.gz`,
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
