import {promises as fs} from 'fs'
import * as path from 'path'

import * as mobile from '../mobile'

// tslint:disable-next-line:no-var-requires
const tmp = require('tmp-promise')

describe('getMD5HashFromFileBuffer', () => {
  test('correctly compute md5 of a file', async () => {
    const dir = (await tmp.dir({mode: 0o755, unsafeCleanup: true})).path
    await fs.writeFile(path.join(dir, 'file.txt'), 'Compute md5')
    const fileBuffer = await fs.readFile(path.join(dir, 'file.txt'))
    expect(await mobile.getMD5HashFromFileBuffer(fileBuffer)).toBe('odk1EOlpz16oPIgnco2nfg==')
  })
})
