//import path from 'path'

import {createUniqueTmpDirectory, deleteDirectory} from '../../dsyms/utils'

import {
  getPEFileMetadata,
} from '../pe'

import {
  MachineArchitecture, 
} from '../pe-constants'

const fixtureDir = './src/commands/pe-symbols/__tests__/fixtures'

describe('pe', () => {
  describe('readInvalidFiles', () => {
    test('throw an error if file does not exist', async () => {
      await expect(getPEFileMetadata(`${fixtureDir}/non_existing_file`)).rejects.toThrow()
    })

    test('return false if a small file is not a PE file', async () => {
      const result = await getPEFileMetadata(`${fixtureDir}/small_invalid.dll`)
      expect(result.isPE).toBeFalsy()
      expect(result.hasPdbInfo).toBeFalsy()
      expect(result.error?.message !== '')
    })

    test('return false if a file is not a PE file', async () => {
      const result = await getPEFileMetadata(`${fixtureDir}/invalid.dll`)
      expect(result.isPE).toBeFalsy()
      expect(result.hasPdbInfo).toBeFalsy()
      expect(result.error?.message !== '')
    })
  })

  describe('getFileMetadata', () => {
    test('return metadata for 32 bit PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/x86/Exports.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: true,
        arch: 1,
        pdbAge: 1,
        pdbSig: 'E37085B2-4E2C-4BF4-B83F-84F16BC71B74',
        filename: 'C:\\Users\\Christophe Nasarre\\source\\repos\\Exports\\Release\\Exports.pdb',
      })
    })

    test('return metadata for 64 bit PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/x64/Exports.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: true,
        arch: 2,
        pdbAge: 1,
        pdbSig: '3E3A3E3A-1C05-4E67-B9B7-99D781E5FB5C',
        filename: 'C:\\Users\\Christophe Nasarre\\source\\repos\\Exports\\x64\\Release\\Exports.pdb',
      })
    })

  })
})
