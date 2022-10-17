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
    platform: RNPlatform,
    build: string
  ): MultipartPayload {
    const content = new Map<string, MultipartValue>([
      ['event', this.getMetadataPayload(cliVersion, service, version, projectPath, platform, build)],
      ['source_map', {value: fs.createReadStream(this.sourcemapPath), options: {filename: 'source_map'}}],
      ['minified_file', {value: fs.createReadStream(this.bundlePath), options: {filename: 'minified_file'}}],
    ])
    if (this.gitData !== undefined && this.gitData.gitRepositoryPayload !== undefined) {
      content.set('repository', {
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

  private getBundleName(bundlePath: string, bundleName?: string): string {
    if (bundleName) {
      return bundleName
    }

    // We return the name of the file on the disk if no bundleName is returned
    const splitPath = bundlePath.split('/')

    return splitPath[splitPath.length - 1]
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
