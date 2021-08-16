import fs from 'fs'

import {MultipartPayload} from '../../helpers/upload'
import {zipToTmpDir} from './utils'

export class Dsym {
  public path: string
  public uuids: string[]

  constructor(path: string, uuids: string[]) {
    this.path = path
    this.uuids = uuids
  }

  public async asMultipartPayload(): Promise<MultipartPayload> {
    const concatUUIDs = this.uuids.join()
    const zipFilePath = await zipToTmpDir(this.path, `${concatUUIDs}.zip`)
    const content = new Map([
      ['symbols_archive', {value: fs.createReadStream(zipFilePath)}],
      ['type', {value: 'ios_symbols'}],
      ['uuids', {value: concatUUIDs}],
    ])

    return {
      content,
    }
  }
}
