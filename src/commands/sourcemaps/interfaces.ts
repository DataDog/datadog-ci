import {AxiosPromise, AxiosResponse} from 'axios'
import fs from 'fs'
import {Writable} from 'stream'

import {MultipartPayload, newMultipartValue} from '../../helpers/upload'

export class Sourcemap {
  // These fields should probably not be marked as public, refactor
  public gitCommitSha?: string
  public gitRepositoryPayload?: string
  public gitRepositoryURL?: string
  public minifiedFilePath: string
  public sourcemapPath: string

  private minifiedUrl: string

  constructor(
    minifiedFilePath: string,
    minifiedUrl: string,
    sourcemapPath: string
  ) {
    this.minifiedFilePath = minifiedFilePath
    this.minifiedUrl = minifiedUrl
    this.sourcemapPath = sourcemapPath
  }

  public addRepositoryData(gitCommitSha: string, gitRepositoryURL: string, gitRepositoryPayload: string) {
    this.gitCommitSha = gitCommitSha
    this.gitRepositoryPayload = gitRepositoryPayload
    this.gitRepositoryURL = gitRepositoryURL
  }

  public asMultipartPayload(
    cliVersion: string,
    service: string,
    version: string,
    projectPath: string
  ): MultipartPayload {
    const content = new Map([
      ['cli_version', newMultipartValue(cliVersion)],
      ['service', newMultipartValue(service)],
      ['version', newMultipartValue(version)],
      ['source_map', newMultipartValue(fs.createReadStream(this.sourcemapPath))],
      ['minified_file', newMultipartValue(fs.createReadStream(this.minifiedFilePath))],
      ['minified_url', newMultipartValue(this.minifiedUrl)],
      ['project_path', newMultipartValue(projectPath)],
      ['type', newMultipartValue('js_sourcemap')],
    ])
    if (this.gitRepositoryPayload) {
      content.set('repository', newMultipartValue(this.gitRepositoryPayload, {filename: 'repository', contentType: 'application/json'}))
    }
    if (this.gitRepositoryURL) {
      content.set('git_repository_url', newMultipartValue(this.gitRepositoryURL))
    }
    if (this.gitCommitSha) {
      content.set('git_commit_sha', newMultipartValue(this.gitCommitSha))
    }

    return {
      content,
      renderUpload: () => `Uploading sourcemap ${this.sourcemapPath} for JS file available at ${this.minifiedUrl}\n`,
    }
  }
}

export interface Payload {
  cliVersion: string
  gitCommitSha?: string
  gitRepositoryPayload?: string
  gitRepositoryURL?: string
  minifiedFilePath: string
  minifiedUrl: string
  overwrite?: boolean
  projectPath: string
  service: string
  sourcemapPath: string
  version: string
}

export interface APIHelper {
  uploadSourcemap(sourcemap: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
