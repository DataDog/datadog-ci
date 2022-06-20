import fs from 'fs'

import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export class RNSourcemap {
  public bundleName: string
  public bundlePath: string
  public gitData?: GitData
  public sourcemapPath: string

  constructor(bundlePath: string, sourcemapPath: string, bundleName?: string) {
    this.bundleName = this.getBundleName(bundlePath, bundleName)
    this.bundlePath = bundlePath
    this.sourcemapPath = sourcemapPath
  }

  public addRepositoryData(gitData: GitData) {
    this.gitData = gitData
  }

  public asMultipartPayload(
    cliVersion: string,
    service: string,
    version: string,
    projectPath: string,
    platform: RNPlatform
  ): MultipartPayload {
    const content = new Map<string, MultipartValue>([
      ['cli_version', {value: cliVersion}],
      ['service', {value: service}],
      ['version', {value: version}],
      ['source_map', {value: fs.createReadStream(this.sourcemapPath)}],
      ['minified_file', {value: fs.createReadStream(this.bundlePath)}],
      ['bundle_name', {value: this.bundleName}],
      ['project_path', {value: projectPath}],
      ['platform', {value: platform}],
      ['type', {value: 'react_native_sourcemap'}],
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

  private getBundleName(bundlePath: string, bundleName?: string): string {
    if (bundleName) {
      return bundleName
    }

    // We return the name of the file on the disk if no bundleName is returned
    const splitPath = bundlePath.split('/')

    return splitPath[splitPath.length - 1]
  }
}

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
}

export const RN_SUPPORTED_PLATFORMS = ['ios', 'android'] as const
// Notice that the array and type can have the same name if you want
export type RNPlatform = typeof RN_SUPPORTED_PLATFORMS[number]
