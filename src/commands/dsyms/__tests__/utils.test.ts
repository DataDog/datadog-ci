// tslint:disable: no-string-literal
import {promises} from 'fs'

import {getMatchingDSYMFiles, isZipFile, unzipToTmpDir, zipToTmpDir} from '../utils'

describe('isZipFile', () => {
  test('Zip file should return true', async () => {
    const zipFile = './src/commands/dsyms/__tests__/files/test.zip'
    expect(await isZipFile(zipFile)).toBeTruthy()
  })

  test('Arbitrary file should return false', async () => {
    const dsymFile = './src/commands/dsyms/__tests__/files/test.dSYM'
    expect(await isZipFile(dsymFile)).toBeFalsy()
  })
})

describe('getMatchingDSYMFiles', () => {
  test('Should find one dSYM file', async () => {
    require('../utils').dwarfdumpUUID = jest.fn().mockResolvedValue(['BD8CE358-D5F3-358B-86DC-CBCF2148097B'])

    const folder = './src/commands/dsyms/__tests__/files/'
    const foundFiles = await getMatchingDSYMFiles(folder)
    expect(foundFiles).toEqual([
      {
        path: './src/commands/dsyms/__tests__/files/test.dSYM',
        type: 'ios_symbols',
        uuids: ['BD8CE358-D5F3-358B-86DC-CBCF2148097B'],
      },
    ])
  })
})

describe('zipToTmpDir', () => {
  test('Zip files to temporary directory', async () => {
    const dsymFile = './src/commands/dsyms/__tests__/files/test.dSYM'
    const zippedFile = await zipToTmpDir(dsymFile, `${Date.now().toString()}.zip`)

    expect((await promises.stat(zippedFile)).size).toBeGreaterThan(0)
  })
})

describe('unzipToTmpDir', () => {
  test('Unzip a file to temporary directory', async () => {
    const zipFile = './src/commands/dsyms/__tests__/files/test.zip'
    const unzippedFolder = await unzipToTmpDir(zipFile)

    expect((await promises.stat(unzippedFolder)).size).toBeGreaterThan(0)
  })
})
