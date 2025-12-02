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
  repositoryURL: string
  commitSHA: string
}

export class CompressedDsym {
  public archivePath: string
  public dsym: Dsym
  public gitData?: GitData

  constructor(archivePath: string, dsym: Dsym, gitData?: GitData) {
    this.archivePath = archivePath
    this.dsym = dsym
    this.gitData = gitData
  }

  public asMultipartPayload(): MultipartPayload {
    const content = new Map([
      ['symbols_archive', {type: 'file', path: this.archivePath, options: {filename: 'ios_symbols_archive'}}],
      ['event', this.getMetadataPayload()],
    ])

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
      metadata.git_repository_url = this.gitData.repositoryURL
      metadata.git_commit_sha = this.gitData.commitSHA
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
