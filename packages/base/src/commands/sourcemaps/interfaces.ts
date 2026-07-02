import type {CommandContext} from '@datadog/datadog-ci-base'
import type {MultipartPayload, MultipartValue} from '@datadog/datadog-ci-base/helpers/upload'

export class Sourcemap {
  public gitData?: GitData
  public minifiedFilePath: string
  public minifiedPathPrefix?: string
  public minifiedUrl: string
  public relativePath: string
  public sourcemapPath: string

  constructor(
    minifiedFilePath: string,
    minifiedUrl: string,
    sourcemapPath: string,
    relativePath: string,
    minifiedPathPrefix?: string
  ) {
    this.minifiedFilePath = minifiedFilePath
    this.minifiedPathPrefix = minifiedPathPrefix
    this.minifiedUrl = minifiedUrl
    this.relativePath = relativePath
    this.sourcemapPath = sourcemapPath
  }

  public addRepositoryData(gitData: GitData) {
    this.gitData = gitData
  }

  public asMultipartPayload(options: SourcemapUploadOptions): MultipartPayload {
    const content = new Map<string, MultipartValue>([
      ['event', this.getMetadataPayload(options)],
      ['source_map', {type: 'file', path: this.sourcemapPath, options: {filename: 'source_map'}}],
      ['minified_file', {type: 'file', path: this.minifiedFilePath, options: {filename: 'minified_file'}}],
    ])
    if (this.gitData !== undefined && this.gitData.gitRepositoryPayload !== undefined) {
      content.set('repository', {
        type: 'string',
        options: {
          contentType: 'application/json',
          filename: 'repository',
        },
        value: this.gitData.gitRepositoryPayload,
      })
    }

    return {
      content,
    }
  }

  private getMetadataPayload({
    cliVersion,
    service,
    version,
    projectPath,
    debugId,
  }: SourcemapUploadOptions): MultipartValue {
    const metadata: {[k: string]: any} = {
      cli_version: cliVersion,
      project_path: projectPath,
      type: 'js_sourcemap',
      service,
      version,
      minified_url: this.minifiedUrl,
      debug_id: debugId,
    }

    if (this.gitData !== undefined) {
      metadata.git_repository_url = this.gitData.gitRepositoryURL
      metadata.git_commit_sha = this.gitData.gitCommitSha
    }

    return {
      type: 'string',
      options: {
        contentType: 'application/json',
        filename: 'event',
      },
      value: JSON.stringify(metadata),
    }
  }
}

export interface SourcemapUploadOptions {
  cliVersion: string
  context: CommandContext
  debugId?: string
  projectPath?: string
  service?: string
  version?: string
}

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
}
