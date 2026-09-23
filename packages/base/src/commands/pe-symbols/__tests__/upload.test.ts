import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import path from 'upath'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'

import {uploadMultipartHelper} from '../helpers'
import {PeSymbolsUploadCommand} from '../upload'

import {bytesAt, FUNCTION, MACHINE, makePE, RVA, SECTION_SIZE, setRuntimeFunction} from './pe-fixture'

const makeMalformedPE = () => {
  const pe = makePE()
  setRuntimeFunction(pe, 0, {...FUNCTION, unwind: 0xfffffffc})

  return pe
}

jest.unmock('chalk')

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(() => Promise.resolve(UploadStatus.Success)),
}))

const fixtureDir = path.join(__dirname, 'fixtures')

describe('pe-symbols upload with unwind information', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-upload-'))
    jest.mocked(uploadMultipartHelper).mockResolvedValue(UploadStatus.Success)
  })

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  const prepare = (binaryContents: Buffer, includeUnwindInfo = true, extension = 'exe') => {
    const binary = path.join(directory, `application.${extension}`)
    const pdb = path.join(directory, 'application.pdb')
    fs.writeFileSync(binary, binaryContents)
    // Payload construction only: native PDB validation is performed by the processor.
    fs.writeFileSync(pdb, 'test PDB payload')
    const command = createCommand(PeSymbolsUploadCommand)
    command['symbolsLocations'] = [binary]
    command['config'] = {apiKey: 'test', datadogSite: 'datadoghq.com'}
    command['includeUnwindInfo'] = includeUnwindInfo

    return {binary, pdb, command}
  }

  const lastPayload = () => jest.mocked(uploadMultipartHelper).mock.calls[0][1]
  const generatesCfi = () =>
    JSON.parse((lastPayload().content.get('event') as MultipartStringValue).value).generate_cfi_cache

  test.each(['dll', 'exe'])('real x64 .%s uploads a reduced companion, never the original', async (extension) => {
    const {binary, pdb, command} = prepare(
      fs.readFileSync(path.join(fixtureDir, 'exports_with_pdb_64.dll')),
      true,
      extension
    )
    let companion = ''
    jest.mocked(uploadMultipartHelper).mockImplementation(async (_request, payload) => {
      companion = (payload.content.get('pe_binary_file') as MultipartFileValue).path
      expect(fs.existsSync(companion)).toBe(true)

      return UploadStatus.Success
    })

    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Success])
    expect((lastPayload().content.get('pe_symbol_file') as MultipartFileValue).path).toBe(pdb)
    expect(companion).not.toBe(binary)
    expect(generatesCfi()).toBe(true)
  })

  test.each([false, true])('reduced x64 PE drops code and data, and is cleaned up after failure=%s', async (fail) => {
    const {command} = prepare(makePE())
    let companion = ''
    jest.mocked(uploadMultipartHelper).mockImplementation(async (_request, payload) => {
      companion = (payload.content.get('pe_binary_file') as MultipartFileValue).path
      const contents = fs.readFileSync(companion)
      expect(contents.includes(Buffer.from('PRIVATE_DATA'))).toBe(false)
      expect(bytesAt(contents, RVA.code, SECTION_SIZE)).toEqual(Buffer.alloc(SECTION_SIZE))

      return fail ? UploadStatus.Failure : UploadStatus.Success
    })

    expect(await command['performPESymbolsUpload']()).toEqual([fail ? UploadStatus.Failure : UploadStatus.Success])
    expect(companion).not.toBe('')
    expect(fs.existsSync(path.dirname(companion))).toBe(false)
  })

  test('x86 requests PDB CFI without a binary attachment', async () => {
    const {command} = prepare(makePE(MACHINE.x86))
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Success])
    expect(lastPayload().content.has('pe_binary_file')).toBe(false)
    expect(generatesCfi()).toBe(true)
  })

  test.each([MACHINE.thumb2, MACHINE.arm64, MACHINE.arm64ec, MACHINE.arm64x])(
    'rejects ARM/hybrid binaries without uploading: %s',
    async (machine) => {
      const {command} = prepare(makePE(machine))
      expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Failure])
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    }
  )

  test('malformed unwind data uploads neither file', async () => {
    const {command} = prepare(makeMalformedPE())
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Failure])
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })

  test('upload errors such as an invalid API key still abort the command', async () => {
    const {command} = prepare(makePE())
    jest.mocked(uploadMultipartHelper).mockRejectedValue(new Error('invalid API key'))
    await expect(command['performPESymbolsUpload']()).rejects.toThrow('invalid API key')
  })

  test('uploads remain PDB-only by default', async () => {
    const {pdb, command} = prepare(makePE(), false)
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Success])
    expect((lastPayload().content.get('pe_symbol_file') as MultipartFileValue).path).toBe(pdb)
    expect(lastPayload().content.has('pe_binary_file')).toBe(false)
    expect(generatesCfi()).toBe(false)
  })

  test.each([false, true])('Breakpad remains a single attachment with include-unwind-info=%s', async (enabled) => {
    const {command} = prepare(makePE(), enabled)
    const sym = path.join(fixtureDir, 'breakpad_example.sym')
    command['symbolsLocations'] = [sym]
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Success])
    expect((lastPayload().content.get('pe_symbol_file') as MultipartFileValue).path).toBe(sym)
    expect(lastPayload().content.has('pe_binary_file')).toBe(false)
  })

  test('dry run extracts and validates unwind information without uploading', async () => {
    const {command} = prepare(makePE())
    command['dryRun'] = true
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Success])
    expect(command.context.stdout.toString()).toContain('Extracted unwind information')
    expect(command.context.stdout.toString()).toContain('[DRYRUN]')
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })

  test('dry run reports missing PDBs and extraction failures', async () => {
    const {command} = prepare(makeMalformedPE())
    command['dryRun'] = true
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Failure])

    const missing = prepare(makePE())
    fs.rmSync(missing.pdb)
    missing.command['dryRun'] = true
    expect(await missing.command['performPESymbolsUpload']()).toEqual([UploadStatus.Skipped])
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })

  test.each([false, true])(
    'extraction failures are reported in the summary and exit 0 like other symbol uploads, dry-run=%s',
    async (dryRun) => {
      const {command} = prepare(makeMalformedPE())
      command['dryRun'] = dryRun
      command['disableGit'] = true
      expect(await command.execute()).toBe(0)
      expect(command.context.stdout.toString()).toContain('Cannot extract PE unwind data')
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    }
  )

  test('missing PDB does not upload the executable on its own', async () => {
    const {pdb, command} = prepare(makePE())
    fs.rmSync(pdb)
    expect(await command['performPESymbolsUpload']()).toEqual([UploadStatus.Skipped])
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })
})
