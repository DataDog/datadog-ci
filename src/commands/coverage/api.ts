import fs from 'fs'
import {createGzip} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import FormData from 'form-data'

import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://ci-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadCodeCoverageReport = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  payload: Payload
) => {
  const form = new FormData()

  const event: Record<string, any> = {
    type: 'coverage_report',
    '_dd.hostname': payload.hostname,
    format: payload.format,
    ...payload.spanTags,
    ...payload.customTags,
    ...payload.customMeasures,
  }

  form.append('event', JSON.stringify(event), {filename: 'event.json'})

  await doWithMaxConcurrency(20, payload.paths, async (path) => {
    const filename = path.split('/').pop() || path
    const gzip = fs.createReadStream(path).pipe(createGzip())
    form.append(filename, gzip, {filename: `${filename}.gz`})
  })

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
  }
}
