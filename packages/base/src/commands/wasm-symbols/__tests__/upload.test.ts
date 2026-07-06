import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {TrackedFilesMatcher} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {renderArgumentMissingError, renderInvalidSymbolsLocation} from '../renderer'
import {WasmSymbolsUploadCommand} from '../upload'
import {WasmSectionId} from '../wasm-constants'

import {buildCustomSection, buildSection, buildWasmModule} from './wasm-test-helpers'

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(() => Promise.resolve(UploadStatus.Success)),
}))

const commonMetadata = {
  cli_version: cliVersion,
  origin: 'datadog-ci',
  origin_version: cliVersion,
  type: 'wasm',
  overwrite: false,
  source_url: undefined,
}

describe('wasm-symbols upload', () => {
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'wasm-upload-tests-'))
    jest.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(fixtureDir, {recursive: true})
  })

  const writeWasmFile = (filename: string, sections: Buffer[]) => {
    const filePath = upath.join(fixtureDir, filename)
    fs.mkdirSync(upath.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, buildWasmModule(sections))

    return filePath
  }

  const withDebugInfo = (buildId: string, codePayload: Buffer) => [
    buildCustomSection('build_id', Buffer.from(buildId, 'hex')),
    buildCustomSection('.debug_info', Buffer.from([0x00])),
    buildSection(WasmSectionId.CODE, codePayload),
  ]

  const runCommand = async (prepFunction: (command: WasmSymbolsUploadCommand) => void) => {
    const command = createCommand(WasmSymbolsUploadCommand)
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context: command.context}
  }

  describe('parameter validation', () => {
    test('fails if symbols locations is empty', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = []
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderArgumentMissingError('symbols locations'))
    })

    test('fails if symbols locations does not exist', async () => {
      const nonExistentSymbolsLocation = upath.join(fixtureDir, 'does-not-exist')
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [nonExistentSymbolsLocation]
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderInvalidSymbolsLocation(nonExistentSymbolsLocation))
    })

    test('fails on an unsupported --arch value', async () => {
      writeWasmFile('a.wasm', withDebugInfo('aabbcc', Buffer.from([0x01])))
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [fixtureDir]
        cmd['arch'] = 'x86_64'
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('arch')
    })
  })

  describe('getWasmSymbolFiles', () => {
    test('finds wasm files with debug info recursively', async () => {
      writeWasmFile('a.wasm', withDebugInfo('aabbcc', Buffer.from([0x01])))
      writeWasmFile('nested/b.wasm', withDebugInfo('ddeeff', Buffer.from([0x02])))

      const command = createCommand(WasmSymbolsUploadCommand)
      const files = await command['getWasmSymbolFiles'](fixtureDir)

      expect(files.map((f) => f.filename).sort()).toEqual(
        [upath.join(fixtureDir, 'a.wasm'), upath.join(fixtureDir, 'nested/b.wasm')].sort()
      )
    })

    test('skips wasm files without debug info', async () => {
      writeWasmFile('no-debug.wasm', [buildSection(WasmSectionId.CODE, Buffer.from([0x01]))])
      writeWasmFile('with-debug.wasm', withDebugInfo('aabbcc', Buffer.from([0x02])))

      const command = createCommand(WasmSymbolsUploadCommand)
      const files = await command['getWasmSymbolFiles'](fixtureDir)

      expect(files.map((f) => f.filename)).toEqual([upath.join(fixtureDir, 'with-debug.wasm')])
    })

    test('throws when a single non-wasm file is given', async () => {
      const filePath = upath.join(fixtureDir, 'not-wasm.txt')
      fs.writeFileSync(filePath, 'hello')

      const command = createCommand(WasmSymbolsUploadCommand)
      await expect(command['getWasmSymbolFiles'](filePath)).rejects.toThrow()
    })
  })

  describe('removeBuildIdDuplicates', () => {
    test('prefers the entry that has embedded debug info', async () => {
      writeWasmFile('external.wasm', [
        buildCustomSection('build_id', Buffer.from('aabbcc', 'hex')),
        buildCustomSection('external_debug_info', Buffer.from('external.debug.wasm')),
        buildSection(WasmSectionId.CODE, Buffer.from([0x01])),
      ])
      writeWasmFile('embedded.wasm', withDebugInfo('aabbcc', Buffer.from([0x02])))

      const command = createCommand(WasmSymbolsUploadCommand)
      const files = await command['getWasmSymbolFiles'](fixtureDir)
      const deduped = command['removeBuildIdDuplicates'](files)

      expect(deduped).toHaveLength(1)
      expect(deduped[0].filename).toBe(upath.join(fixtureDir, 'embedded.wasm'))
    })
  })

  describe('upload', () => {
    test('creates correct metadata payload', () => {
      const command = createCommand(WasmSymbolsUploadCommand)
      command['symbolsLocations'] = [fixtureDir]
      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([]),
      }

      const wasmFileMetadata = {
        filename: './a/b/c/fake-filename.wasm',
        isWasm: true,
        arch: 'wasm32',
        buildId: 'fake-build-id',
        fileHash: 'fake-file-hash',
        hasDebugInfo: true,
        hasExternalDebugInfo: false,
        hasCode: true,
      }
      const metadata = command['getMappingMetadata'](wasmFileMetadata)

      expect(metadata).toEqual({
        ...commonMetadata,
        arch: 'wasm32',
        build_id: 'fake-build-id',
        file_hash: 'fake-file-hash',
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        symbol_source: 'debug_info',
        filename: 'fake-filename.wasm',
      })

      command['replaceExisting'] = true
      const metadataReplaceExisting = command['getMappingMetadata'](wasmFileMetadata)
      expect(metadataReplaceExisting).toEqual({...metadata, overwrite: true})
    })

    test('uploads correct multipart payload', async () => {
      writeWasmFile('a.wasm', withDebugInfo('aabbcc', Buffer.from([0x01, 0x02])))
      writeWasmFile('b.wasm', withDebugInfo('ddeeff', Buffer.from([0x03, 0x04])))

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [fixtureDir]
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(2)

      const calls = (uploadMultipartHelper as jest.Mock).mock.calls.map((call) => {
        const payload = call[1] as MultipartPayload
        const fileItem = payload.content.get('wasm_symbol_file') as MultipartFileValue
        expect(fileItem).toBeTruthy()
        expect(fileItem.options.filename).toBe('wasm_symbol_file')

        return JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      })
      calls.sort((a, b) => (a.build_id as string).localeCompare(b.build_id as string))

      expect(calls).toEqual([
        {
          ...commonMetadata,
          arch: 'wasm32',
          build_id: 'aabbcc',
          file_hash: calls[0].file_hash,
          filename: 'a.wasm',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          arch: 'wasm32',
          build_id: 'ddeeff',
          file_hash: calls[1].file_hash,
          filename: 'b.wasm',
          symbol_source: 'debug_info',
        },
      ])
    })

    test('skips upload on dry run', async () => {
      writeWasmFile('a.wasm', withDebugInfo('aabbcc', Buffer.from([0x01])))

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [fixtureDir]
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
