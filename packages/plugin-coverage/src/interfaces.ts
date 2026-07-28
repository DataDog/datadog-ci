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
  coverageConfig: CoverageConfig | undefined
  codeowners: RepoFile | undefined
  fileFixesCompressed: Buffer | undefined
}

export interface RepoFile {
  path: string
  sha: string
}

/**
 * The code coverage configuration is either resolved from the repository, in which case the backend
 * looks the blob up in GitDB, or read from a local file, in which case we upload its contents.
 */
export type CoverageConfig = ({source: 'repository'} & RepoFile) | LocalCoverageConfig

export interface LocalCoverageConfig {
  source: 'local'
  path: string
  compressed: Buffer
}

export interface APIHelper {
  uploadCodeCoverageReport(codeCoverageReport: Payload): Promise<RequestResponse>
}
