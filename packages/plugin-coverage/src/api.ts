import fs from 'fs'
import {createGzip, gzipSync} from 'zlib'

import type {Payload} from './interfaces'
import type {RequestConfig, RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

import {getApiUrl, getIntakeUrl} from '@datadog/datadog-ci-base/helpers/api'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {datadogRoute} from '@datadog/datadog-ci-base/helpers/datadog-route'
import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import FormData from 'form-data'

export const intakeUrl = getIntakeUrl('ci-intake')
export const apiUrl = getApiUrl()

export const uploadCodeCoverageReport =
  (request: (args: RequestConfig) => Promise<RequestResponse>) => async (payload: Payload) => {
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

    if (payload.fileFixesCompressed) {
      form.append('file_fixes', payload.fileFixesCompressed, {
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
      method: 'POST',
      url: datadogRoute('/api/v2/cicovreprt'),
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
