import {AxiosPromise, AxiosResponse} from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import {Writable} from 'stream'

import {ICONS} from '../../helpers/formatting'
import {MultipartPayload, MultipartValue} from '../../helpers/upload'

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
