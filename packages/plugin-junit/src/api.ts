import fs from 'fs'
import {createGzip} from 'zlib'

import type {Payload} from './interfaces'
import type {RequestConfig, RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

import {getApiUrl, getIntakeUrl} from '@datadog/datadog-ci-base/helpers/api'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'
import upath from 'upath'
import {v4 as uuidv4} from 'uuid'

export const intakeUrl = getIntakeUrl('cireport-intake')
export const apiUrl = getApiUrl()

export const uploadJUnitXML =
  (request: (args: RequestConfig) => Promise<RequestResponse>) => async (jUnitXML: Payload) => {
    const form = new FormData()

    let fileName
    try {
      fileName = upath.parse(jUnitXML.xmlPath).name
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
