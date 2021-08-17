import fs from 'fs'

import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export class Sourcemap {
  public gitData?: GitData
  public minifiedFilePath: string
  public minifiedUrl: string
  public sourcemapPath: string

  constructor(
    minifiedFilePath: string,
    minifiedUrl: string,
    sourcemapPath: string
  ) {
    this.minifiedFilePath = minifiedFilePath
    this.minifiedUrl = minifiedUrl
    this.sourcemapPath = sourcemapPath
  }

  public addRepositoryData(gitData: GitData) {
    this.gitData = gitData
  }

  public asMultipartPayload(
    cliVersion: string,
    service: string,
    version: string,
    projectPath: string
  ): MultipartPayload {
    const content = new Map<string, MultipartValue>([
      ['cli_version', {value: cliVersion}],
      ['service', {value: service}],
      ['version', {value: version}],
      ['source_map', {value: fs.createReadStream(this.sourcemapPath)}],
      ['minified_file', {value: fs.createReadStream(this.minifiedFilePath)}],
      ['minified_url', {value: this.minifiedUrl}],
      ['project_path', {value: projectPath}],
      ['type', {value: 'js_sourcemap'}],
    ])
    if (this.gitData !== undefined) {
      if ((this.gitData!).gitRepositoryPayload !== undefined) {
        content.set('repository', {
          options: {
            contentType: 'application/json',
            filename: 'repository',
          },
          value: (this.gitData!).gitRepositoryPayload,
        })
      }
      content.set('git_repository_url', {value: (this.gitData!).gitRepositoryURL})
      content.set('git_commit_sha', {value: (this.gitData!).gitCommitSha})
    }

    return {
      content,
    }
  }
}

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
}
