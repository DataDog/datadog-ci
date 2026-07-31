import type {DiffData} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import type {RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

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
  // Gzipped file content, only set when the content could be read and is attached to the request.
  // When absent, the backend reads the content from the committed blob at `path`/`sha` instead.
  gzippedContent?: Buffer
  // Uncompressed size of the attached content, for reporting purposes.
  size?: number
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): Promise<RequestResponse>
}
