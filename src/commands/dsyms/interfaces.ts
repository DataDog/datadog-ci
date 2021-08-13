import chalk from 'chalk'
import fs from 'fs'

import {ICONS} from '../../helpers/formatting'
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
      renderFailedUpload: (errorMessage: string) => {
        const dSYMPathBold = `[${chalk.bold.dim(this.path)}]`

        return chalk.red(`${ICONS.FAILED} Failed upload dSYM for ${dSYMPathBold}: ${errorMessage}\n`)
      },
      renderRetry: (errorMessage: string, attempt: number) => {
        const dSYMPathBold = `[${chalk.bold.dim(this.path)}]`

        return chalk.yellow(`[attempt ${attempt}] Retrying dSYM upload ${dSYMPathBold}: ${errorMessage}\n`)
      },
      renderUpload: () => `Uploading dSYM with ${this.uuids} from ${this.path}\n`,
    }
  }
}
