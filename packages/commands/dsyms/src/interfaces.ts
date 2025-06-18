import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export interface Dsym {
  bundlePath: string
  slices: ArchSlice[]
}

export interface ArchSlice {
  arch: string
  objectPath: string
  uuid: string
}

export class CompressedDsym {
  public archivePath: string
  public dsym: Dsym

  constructor(archivePath: string, dsym: Dsym) {
    this.archivePath = archivePath
    this.dsym = dsym
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
    const concatUUIDs = this.dsym.slices.map((slice) => slice.uuid).join()

    return {
      type: 'string',
      options: {
        contentType: 'application/json',
        filename: 'event',
      },
      value: JSON.stringify({
        type: 'ios_symbols',
        uuids: concatUUIDs,
      }),
    }
  }
}
