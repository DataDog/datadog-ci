import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import path from 'upath'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'

import {uploadMultipartHelper} from '../helpers'
import {PeSymbolsUploadCommand} from '../upload'

jest.unmock('chalk')

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(() => Promise.resolve(UploadStatus.Success)),
}))

const fixtureDir = path.join(__dirname, 'fixtures')

describe('pe-symbols paired upload', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-upload-'))
  })

  afterEach(() => {
    fs.rmSync(directory, {recursive: true, force: true})
  })

  const upload = async (filename: string) => {
    const command = createCommand(PeSymbolsUploadCommand)
    command['symbolsLocations'] = [filename]
    command['config'] = {apiKey: 'test', datadogSite: 'datadoghq.com'}

    return command['performPESymbolsUpload']()
  }

  test.each(['dll', 'exe'])('native .%s uploads its companion by default', async (extension) => {
    const binary = path.join(directory, `application.${extension}`)
    const pdb = path.join(directory, 'application.pdb')
    fs.copyFileSync(path.join(fixtureDir, 'exports_with_pdb_64.dll'), binary)
    // Payload construction only: native PDB validation is performed by the processor.
    fs.writeFileSync(pdb, 'test PDB payload')

    expect(await upload(binary)).toEqual([UploadStatus.Success])
    expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
    const payload = jest.mocked(uploadMultipartHelper).mock.calls[0][1]
    expect((payload.content.get('pe_symbol_file') as MultipartFileValue).path).toBe(pdb)
    const metadata = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
    expect(metadata.generate_cfi_cache).toBe(true)
    expect(payload.content.get('pe_binary_file')).toEqual({
      type: 'file',
      path: binary,
      options: {filename: 'pe_binary_file'},
    })
  })

  test('Breakpad remains a single symbol attachment', async () => {
    const sym = path.join(fixtureDir, 'breakpad_example.sym')
    expect(await upload(sym)).toEqual([UploadStatus.Success])
    const payload = jest.mocked(uploadMultipartHelper).mock.calls[0][1]
    expect((payload.content.get('pe_symbol_file') as MultipartFileValue).path).toBe(sym)
    expect(payload.content.has('pe_binary_file')).toBe(false)
  })

  test('missing PDB does not upload the executable on its own', async () => {
    const binary = path.join(directory, 'application.dll')
    fs.copyFileSync(path.join(fixtureDir, 'exports_with_pdb_64.dll'), binary)
    expect(await upload(binary)).toEqual([UploadStatus.Skipped])
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })
})
