import fs from 'fs'

import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export class RNSourcemap {
  public gitData?: GitData
  public bundlePath: string
  public sourcemapPath: string
  public bundleName: string

  constructor(bundlePath: string, sourcemapPath: string, bundleName?: string) {
    this.bundlePath = bundlePath
    this.sourcemapPath = sourcemapPath
    this.bundleName = this.getBundleName(bundlePath, bundleName)
  }

  private getBundleName(bundlePath: string, bundleName?: string): string {
    if (bundleName) return bundleName

    // We return the name of the file on the disk if no bundleName is returned
    const splitPath = bundlePath.split('/')
    return splitPath[splitPath.length - 1]
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
      ['minified_file', {value: fs.createReadStream(this.bundlePath)}],
      ['minified_url', {value: this.bundleName}],
      ['project_path', {value: projectPath}],
      ['type', {value: 'js_sourcemap'}], // TODO?
    ])
    if (this.gitData !== undefined) {
      if (this.gitData!.gitRepositoryPayload !== undefined) {
        content.set('repository', {
          options: {
            contentType: 'application/json',
            filename: 'repository',
          },
          value: this.gitData!.gitRepositoryPayload,
        })
      }
      content.set('git_repository_url', {value: this.gitData!.gitRepositoryURL})
      content.set('git_commit_sha', {value: this.gitData!.gitCommitSha})
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
