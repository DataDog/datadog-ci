import fs from 'fs'

import {MultipartPayload} from '../../helpers/upload'

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
    const concatUUIDs = this.dsym.slices.map((slice) => slice.uuid).join()
    const content = new Map([
      ['symbols_archive', {value: fs.createReadStream(this.archivePath)}],
      ['type', {value: 'ios_symbols'}],
      ['uuids', {value: concatUUIDs}],
    ])

    return {
      content,
    }
  }
}
