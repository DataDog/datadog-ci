import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

import {DiffData} from '../git-metadata/git'

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
