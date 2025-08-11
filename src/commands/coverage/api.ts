import fs from 'fs'
import {createGzip, gzipSync} from 'zlib'

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

  if (payload.prDiff) {
    form.append('pr_diff', gzipSync(Buffer.from(JSON.stringify(payload.prDiff), 'utf8')), {
      filename: 'pr_diff.json.gz',
    })
  }

  if (payload.commitDiff) {
    form.append('commit_diff', gzipSync(Buffer.from(JSON.stringify(payload.commitDiff), 'utf8')), {
      filename: 'commit_diff.json.gz',
    })
  }

  await doWithMaxConcurrency(20, payload.paths, async (path) => {
    const gzip = fs.createReadStream(path).pipe(createGzip())
    form.append('code_coverage_report_file', gzip, {filename: `${getReportFilename(path)}.gz`})
  })

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/cicovreprt',
  })
}

const getReportFilename = (path: string) => {
  const filename = path.split('/').pop() || path

  // Remove leading dot if it exists, as the backend does not accept filenames starting with a dot
  return filename.startsWith('.') ? filename.slice(1) : filename
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadCodeCoverageReport: uploadCodeCoverageReport(requestIntake),
  }
}
