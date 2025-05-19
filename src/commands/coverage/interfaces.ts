import type {AxiosPromise, AxiosResponse} from 'axios'

import {SpanTags} from '../../helpers/interfaces'

import {DiffNode} from '../git-metadata/git'

export interface Payload {
  hostname: string
  spanTags: SpanTags
  customTags: Record<string, string>
  customMeasures: Record<string, number>
  paths: string[]
  format: string
  commitDiff: Record<string, DiffNode> | undefined
  prDiff: Record<string, DiffNode> | undefined
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): AxiosPromise<AxiosResponse>
}
