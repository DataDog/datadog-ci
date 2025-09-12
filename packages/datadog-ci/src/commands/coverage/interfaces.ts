import type {AxiosPromise, AxiosResponse} from 'axios'

import {DiffData} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

export interface Payload {
  hostname: string
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
  paths: string[]
  format: string
  basePath: string | undefined
  commitDiff: DiffData | undefined
  prDiff: DiffData | undefined
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): AxiosPromise<AxiosResponse>
}
