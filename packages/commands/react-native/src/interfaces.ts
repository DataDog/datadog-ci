import fs from 'fs'

import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export class RNSourcemap {
  public bundleName: string
  public gitData?: GitData
  public sourcemapPath: string

  constructor(bundleName: string, sourcemapPath: string) {
    this.bundleName = bundleName
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
    platform: RNPlatform,
    build: string
  ): MultipartPayload {
    const content = new Map<string, MultipartValue>([
      ['event', this.getMetadataPayload(cliVersion, service, version, projectPath, platform, build)],
      ['source_map', {type: 'file', path: this.sourcemapPath, options: {filename: 'source_map'}}],
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

  public removeSourcesContentFromSourceMap = () => {
    const newSourcemapFilePath = `${this.sourcemapPath}.no-sources-content`
    const data = fs.readFileSync(this.sourcemapPath, 'utf8')
    const sourcemap = JSON.parse(data)
    delete sourcemap.sourcesContent

    fs.writeFileSync(newSourcemapFilePath, JSON.stringify(sourcemap), 'utf8')
    this.sourcemapPath = newSourcemapFilePath
  }

  private getMetadataPayload(
    cliVersion: string,
    service: string,
    version: string,
    projectPath: string,
    platform: RNPlatform,
    build: string
  ): MultipartValue {
    const metadata: {[k: string]: any} = {
      build_number: build,
      bundle_name: this.bundleName,
      cli_version: cliVersion,
      platform,
      project_path: projectPath,
      service,
      type: 'react_native_sourcemap',
      version,
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

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
}

export const RN_SUPPORTED_PLATFORMS = ['ios', 'android'] as const
// Notice that the array and type can have the same name if you want
export type RNPlatform = typeof RN_SUPPORTED_PLATFORMS[number]
