import {MultipartPayload, MultipartValue} from '@datadog/datadog-ci-base/helpers/upload'

export interface Dsym {
  bundle: string
  dwarf: DWARF[]
}
export interface DWARF {
  object: string
  uuid: string
  arch: string
}

export interface GitData {
  gitCommitSha: string
  gitRepositoryPayload?: string
  gitRepositoryURL: string
}

export class CompressedDsym {
  public archivePath: string
  public dsym: Dsym
  public gitData?: GitData

  constructor(archivePath: string, dsym: Dsym) {
    this.archivePath = archivePath
    this.dsym = dsym
  }

  public asMultipartPayload(): MultipartPayload {
    const content = new Map([
      ['symbols_archive', {type: 'file', path: this.archivePath, options: {filename: 'ios_symbols_archive'}}],
      ['event', this.getMetadataPayload()],
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

  private getMetadataPayload(): MultipartValue {
    const concatUUIDs = this.dsym.dwarf.map((d) => d.uuid).join()

    const metadata: {[k: string]: any} = {
      type: 'ios_symbols',
      uuids: concatUUIDs,
    }

    if (this.gitData) {
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
