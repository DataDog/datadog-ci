import fs from 'fs'
import {createGzip, gzipSync} from 'zlib'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'

import {Payload} from './interfaces'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const intakeUrl = `https://ci-intake.${datadogSite}`
export const apiUrl = `https://api.${datadogSite}`

export const uploadCodeCoverageReport =
  (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (payload: Payload) => {
    const form = new FormData()

    const event: Record<string, any> = {
      type: 'coverage_report',
      '_dd.hostname': payload.hostname,
      format: payload.format,
      basepath: payload.basePath,
      ...payload.spanTags,
      ...(payload.flags ? {'report.flags': payload.flags} : {}),
    }

    if (payload.codeowners) {
      event['codeowners.path'] = payload.codeowners.path
      event['codeowners.sha'] = payload.codeowners.sha
    }

    if (payload.coverageConfig) {
      event['config.path'] = payload.coverageConfig.path
      event['config.sha'] = payload.coverageConfig.sha
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

    if (payload.fileFixes && Object.keys(payload.fileFixes).length > 0) {
      form.append('file_fixes', gzipSync(Buffer.from(JSON.stringify(payload.fileFixes), 'utf8')), {
        filename: 'file_fixes.json.gz',
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
