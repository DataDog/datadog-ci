import {AxiosPromise, AxiosResponse} from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import {Writable} from 'stream'

import {ICONS} from '../../helpers/formatting'
import {MultipartPayload, newMultipartValue} from '../../helpers/upload'

export class Sourcemap {
  // These fields should probably not be marked as public, refactor
  public gitData?: GitData
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

  public addRepositoryData(gitData: GitData) {
    this.gitData = gitData
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
    if (this.gitData !== undefined) {
      if ((this.gitData!).gitRepositoryPayload !== undefined) {
        content.set('repository', newMultipartValue((this.gitData!).gitRepositoryPayload, {filename: 'repository', contentType: 'application/json'}))
      }
      content.set('git_repository_url', newMultipartValue((this.gitData!).gitRepositoryURL))
      content.set('git_commit_sha', newMultipartValue((this.gitData!).gitCommitSha))
    }

    return {
      content,
      renderFailedUpload: (errorMessage: string) => {
        const sourcemapPathBold = `[${chalk.bold.dim(this.sourcemapPath)}]`

        return chalk.red(`${ICONS.FAILED} Failed upload sourcemap for ${sourcemapPathBold}: ${errorMessage}\n`)
      },
      renderRetry: (errorMessage: string, attempt: number) => {
        const sourcemapPathBold = `[${chalk.bold.dim(this.sourcemapPath)}]`

        return chalk.yellow(`[attempt ${attempt}] Retrying sourcemap upload ${sourcemapPathBold}: ${errorMessage}\n`)
      },
      renderUpload: () => `Uploading sourcemap ${this.sourcemapPath} for JS file available at ${this.minifiedUrl}\n`,
    }
  }
}

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
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
