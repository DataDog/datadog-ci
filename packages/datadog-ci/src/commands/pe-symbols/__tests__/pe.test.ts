import {getBreakpadSymMetadata} from '../breakpad'
import {MachineArchitecture} from '../pe-constants'
import {getPEFileMetadata} from '../pe'

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
      expect(result.error?.message !== '').toBeTruthy()
    })

    test('return false if a file is not a PE file', async () => {
      const result = await getPEFileMetadata(`${fixtureDir}/invalid.dll`)
      expect(result.isPE).toBeFalsy()
      expect(result.hasPdbInfo).toBeFalsy()
      expect(result.error?.message !== '').toBeTruthy()
    })
  })

  describe('getFileMetadata', () => {
    test('return metadata for 32 bit PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/exports_with_pdb_32.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: true,
        arch: 1,
        pdbAge: 1,
        pdbSig: 'E37085B2-4E2C-4BF4-B83F-84F16BC71B74',
        pdbFilename: 'C:\\Users\\Christophe Nasarre\\source\\repos\\Exports\\Release\\Exports.pdb',
        filename: './src/commands/pe-symbols/__tests__/fixtures/exports_with_pdb_32.dll',
        sourceType: 'pe_binary',
      })
    })

    test('return no metadata for 32 bit release PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/exports_without_pdb_32.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: false,
        arch: 1,
        pdbAge: 0,
        pdbSig: undefined,
        filename: './src/commands/pe-symbols/__tests__/fixtures/exports_without_pdb_32.dll',
        pdbFilename: '',
        sourceType: 'pe_binary',
      })
    })

    test('return metadata for 64 bit PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/exports_with_pdb_64.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: true,
        arch: 2,
        pdbAge: 1,
        pdbSig: '3E3A3E3A-1C05-4E67-B9B7-99D781E5FB5C',
        filename: './src/commands/pe-symbols/__tests__/fixtures/exports_with_pdb_64.dll',
        pdbFilename: 'C:\\Users\\Christophe Nasarre\\source\\repos\\Exports\\x64\\Release\\Exports.pdb',
        sourceType: 'pe_binary',
      })
    })

    test('return no metadata for 64 bit release PE file', async () => {
      expect(await getPEFileMetadata(`${fixtureDir}/exports_without_pdb_64.dll`)).toEqual({
        isPE: true,
        hasPdbInfo: false,
        arch: 2,
        pdbAge: 0,
        pdbSig: undefined,
        filename: './src/commands/pe-symbols/__tests__/fixtures/exports_without_pdb_64.dll',
        pdbFilename: '',
        sourceType: 'pe_binary',
      })
    })
  })

  describe('breakpad symbols', () => {
    test('extract metadata with line info', async () => {
      expect(await getBreakpadSymMetadata(`${fixtureDir}/breakpad_example.sym`)).toEqual({
        filename: './src/commands/pe-symbols/__tests__/fixtures/breakpad_example.sym',
        isPE: false,
        hasPdbInfo: true,
        arch: MachineArchitecture.x86,
        pdbAge: 0x2a,
        pdbSig: '00112233-4455-6677-8899-AABBCCDDEEFF',
        pdbFilename: 'example.pdb',
        sourceType: 'breakpad_sym',
        symbolPath: './src/commands/pe-symbols/__tests__/fixtures/breakpad_example.sym',
        symbolSource: 'debug_info',
        moduleOs: 'windows',
      })
    })

    test('extract metadata without line info', async () => {
      expect(await getBreakpadSymMetadata(`${fixtureDir}/breakpad_public_only.sym`)).toEqual({
        filename: './src/commands/pe-symbols/__tests__/fixtures/breakpad_public_only.sym',
        isPE: false,
        hasPdbInfo: true,
        arch: MachineArchitecture.x64,
        pdbAge: 0x1,
        pdbSig: 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF',
        pdbFilename: 'sample.pdb',
        sourceType: 'breakpad_sym',
        symbolPath: './src/commands/pe-symbols/__tests__/fixtures/breakpad_public_only.sym',
        symbolSource: 'symbol_table',
        moduleOs: 'windows',
      })
    })

    test('rejects files without MODULE header', async () => {
      await expect(getBreakpadSymMetadata(`${fixtureDir}/breakpad_invalid_no_module.sym`)).rejects.toThrow(
        'first non-empty line must be a Breakpad MODULE header'
      )
    })

    test('rejects files with non ASCII characters', async () => {
      await expect(getBreakpadSymMetadata(`${fixtureDir}/breakpad_invalid_non_ascii.sym`)).rejects.toThrow(
        'Breakpad .sym files must be ASCII encoded'
      )
    })
  })
})
