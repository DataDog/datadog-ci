import fs from 'fs'
import path from 'path'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'
import {v4 as uuidv4} from 'uuid'

import {getRequestBuilder} from '../../helpers/utils'

import {Flush, Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://ci-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadCodeCoverageReport = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  codeCoverageReport: Payload
) => {
  const form = new FormData()

  let fileName
  try {
    fileName = path.parse(codeCoverageReport.path).name
  } catch (e) {
    fileName = 'default_file_name'
  }

  const custom: Record<string, any> = {
    ...codeCoverageReport.spanTags,
    ...codeCoverageReport.customTags,
    ...codeCoverageReport.customMeasures,
    '_dd.hostname': codeCoverageReport.hostname,
    '_dd.report_name': fileName,
    type: 'coverage_report',
    format: codeCoverageReport.format,
  }

  form.append('event', JSON.stringify(custom), {filename: 'event.json'})
  form.append('code_coverage_report_file', fs.createReadStream(codeCoverageReport.path).pipe(createGzip()), {
    filename: `${uuidv4()}.gz`,
  })

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/cicovreprt',
  })
}

export const flushCodeCoverage = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  flushSignal: Flush
) => {
  const form = new FormData()

  const custom: Record<string, any> = {
    ...flushSignal.spanTags,
    ...flushSignal.customTags,
    ...flushSignal.customMeasures,
    '_dd.hostname': flushSignal.hostname,
    type: 'coverage_report',
    flush: 'true',
  }

  form.append('event', JSON.stringify(custom), {filename: 'event.json'})

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/cicovreprt',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadCodeCoverageReport: uploadCodeCoverageReport(requestIntake),
    flushCodeCoverage: flushCodeCoverage(requestIntake),
  }
}
