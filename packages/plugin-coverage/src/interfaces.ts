import type {AxiosPromise, AxiosResponse} from 'axios'

import {DiffData} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

export type FileFixes = Record<string, {lines: number; bitmap: string}>

export interface Payload {
  hostname: string
  spanTags: SpanTags
  flags?: string[]
  paths: string[]
  format: string
  basePath: string | undefined
  commitDiff: DiffData | undefined
  prDiff: DiffData | undefined
  coverageConfig: RepoFile | undefined
  codeowners: RepoFile | undefined
  fileFixesCompressed: Buffer | undefined
}

export interface RepoFile {
  path: string
  sha: string
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): AxiosPromise<AxiosResponse>
}
