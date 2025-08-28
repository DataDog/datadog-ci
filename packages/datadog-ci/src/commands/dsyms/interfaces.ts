import {MultipartPayload, MultipartValue} from '../../helpers/upload'

export interface Dsym {
  bundle: string
  dwarf: DWARF[]
}
export interface DWARF {
  object: string
  uuid: string
  arch: string
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
    const concatUUIDs = this.dsym.dwarf.map((d) => d.uuid).join()

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
