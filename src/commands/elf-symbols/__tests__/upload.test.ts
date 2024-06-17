import fs from 'fs'
import os from 'os'
import path from 'path'

import {createCommand} from '../../../helpers/__tests__/fixtures'
import {TrackedFilesMatcher} from '../../../helpers/git/format-git-sourcemaps-data'
import {MultipartFileValue, MultipartPayload, MultipartStringValue, UploadStatus} from '../../../helpers/upload'
import {version} from '../../../helpers/version'

import {uploadMultipartHelper} from '../helpers'
import {renderArgumentMissingError, renderInvalidSymbolsLocation} from '../renderer'
import {UploadCommand} from '../upload'

jest.mock('../../../helpers/utils', () => ({
  ...jest.requireActual('../../../helpers/utils'),
  performSubCommand: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(() => Promise.resolve(UploadStatus.Success)),
}))

jest.mock('../../../helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('../../../helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

const fixtureDir = './src/commands/elf-symbols/__tests__/fixtures'
const cliVersion = version

describe('elf-symbols upload', () => {
  const runCommand = async (prepFunction: (command: UploadCommand) => void) => {
    const command = createCommand(UploadCommand)
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
      const nonExistentSymbolsLocation = `${fixtureDir}/does-not-exist`
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [nonExistentSymbolsLocation]
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderInvalidSymbolsLocation(nonExistentSymbolsLocation))
    })

    test('uses API Key from env over config from JSON file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['configPath'] = `${fixtureDir}/config/datadog-ci.json`
        cmd['symbolsLocations'] = [fixtureDir]
        process.env.DATADOG_API_KEY = 'fake_api_key'
      })
      const output = context.stdout.toString().split(os.EOL)

      expect(exitCode).toBe(0)

      expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
      expect(output).toContain('The environment API key ending in _key will be used.')
    })
  })

  describe('getElfSymbolFiles', () => {
    test('should find all symbol files', async () => {
      const command = createCommand(UploadCommand)
      const files = await command['getElfSymbolFiles'](fixtureDir)
      expect(files.map((f) => f.filename)).toEqual([
        `${fixtureDir}/.debug/dyn_aarch64.debug`,
        `${fixtureDir}/dyn_aarch64`,
        `${fixtureDir}/dyn_aarch64_nobuildid`,
        `${fixtureDir}/dyn_x86_64`,
        `${fixtureDir}/exec_aarch64`,
        `${fixtureDir}/exec_arm_big`,
        `${fixtureDir}/exec_arm_little`,
      ])
    })

    test('should accept elf file with only dynamic symbols if --dynsym option is passed', async () => {
      const command = createCommand(UploadCommand)
      command['uploadDynamicSymbolTable'] = true
      const files = await command['getElfSymbolFiles'](fixtureDir)

      expect(files.map((f) => f.filename)).toEqual([
        `${fixtureDir}/.debug/dyn_aarch64.debug`,
        `${fixtureDir}/dyn_aarch64`,
        `${fixtureDir}/dyn_aarch64_nobuildid`,
        `${fixtureDir}/dyn_x86_64`,
        `${fixtureDir}/exec_aarch64`,
        `${fixtureDir}/exec_arm_big`,
        `${fixtureDir}/exec_arm_little`,
        `${fixtureDir}/go_x86_64_both_gnu_and_go_build_id`,
        `${fixtureDir}/go_x86_64_only_go_build_id`,
        `${fixtureDir}/go_x86_64_only_go_build_id.debug`,
      ])
    })

    test('should throw an error when input is a single non-elf file', async () => {
      const command = createCommand(UploadCommand)
      await expect(command['getElfSymbolFiles'](`${fixtureDir}/non_elf_file`)).rejects.toThrow()
    })

    test('should throw an error when input is a single elf file without symbols', async () => {
      const command = createCommand(UploadCommand)
      await expect(command['getElfSymbolFiles'](`${fixtureDir}/go_x86_64_only_go_build_id`)).rejects.toThrow()
    })

    test('should not throw an error when a directory (except top-level) is not readable', async () => {
      const command = createCommand(UploadCommand)
      let tmpDir
      try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elf-tests-'))
        const tmpSubDir = fs.mkdtempSync(path.join(tmpDir, 'unreadable-'))
        fs.chmodSync(tmpSubDir, 0o200)
        await expect(command['getElfSymbolFiles'](tmpDir)).resolves.toEqual([])
      } finally {
        if (tmpDir) {
          fs.rmSync(tmpDir, {recursive: true})
        }
      }
    })
  })

  describe('upload', () => {
    test('creates correct metadata payload', async () => {
      const command = createCommand(UploadCommand)
      command['symbolsLocations'] = [fixtureDir]

      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([]),
      }

      const metadata = command['getMappingMetadata'](
        'fake-gnu-build-id',
        'fake-go-build-id',
        'fake-file-hash',
        'x86_64',
        'symbol_table'
      )

      expect(metadata).toEqual({
        arch: 'x86_64',
        gnu_build_id: 'fake-gnu-build-id',
        go_build_id: 'fake-go-build-id',
        file_hash: 'fake-file-hash',
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        platform: 'elf',
        symbol_source: 'symbol_table',
        type: 'elf_symbol_file',
      })
    })

    test('uploads correct multipart payload with multiple locations', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/dyn_aarch64`, `${fixtureDir}/exec_aarch64`]
      })

      const expectedMetadata = [
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: 'd19d63194275d385e3dd852b80d5ba7a',
          gnu_build_id: '32cc243a7921912e295d578637cff3a0b8a4c627',
          go_build_id: '',
          arch: 'aarch64',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: '5ba2907faebb8002de89711d5f0f005c',
          gnu_build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          go_build_id: '',
          arch: 'aarch64',
          symbol_source: 'debug_info',
        },
      ]

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(expectedMetadata.length)
      const metadata = (uploadMultipartHelper as jest.Mock).mock.calls.map((call) => {
        const payload = call[1] as MultipartPayload
        const mappingFileItem = payload.content.get('elf_symbol_file') as MultipartFileValue
        expect(mappingFileItem).toBeTruthy()
        expect(mappingFileItem.options.filename).toBe('elf_symbol_file')

        return JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      })
      const getId = (m: any) => m.gnu_build_id || m.go_build_id || m.file_hash
      metadata.sort((a, b) => getId(a).localeCompare(getId(b)))
      expectedMetadata.sort((a, b) => getId(a).localeCompare(getId(b)))
      expect(metadata).toEqual(expectedMetadata)
      expect(exitCode).toBe(0)
    })

    test('uploads correct multipart payload without repository', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [fixtureDir]
      })

      const expectedMetadata = [
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: 'd19d63194275d385e3dd852b80d5ba7a',
          gnu_build_id: '32cc243a7921912e295d578637cff3a0b8a4c627',
          go_build_id: '',
          arch: 'aarch64',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: '',
          gnu_build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          go_build_id: '',
          arch: 'aarch64',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: 'e8a12b7f5702d7a4f92da4983d75e9af',
          gnu_build_id: 'a8ac08faa0d114aa65f1ee0730af38903ac506de',
          go_build_id: '',
          arch: 'x86_64',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: '3c8e0a68a99a3a03836d225a33ac1f8d',
          gnu_build_id: '623209afd6c408f9009e57fad28782f056112daf',
          go_build_id: '',
          arch: 'arm',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: 'f984122099288eea0f23e7444dd9076c',
          gnu_build_id: '18c30e2d7200682b5ab36c83060c9d6fcd083a3a',
          go_build_id: '',
          arch: 'arm',
          symbol_source: 'debug_info',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          file_hash: 'b3af701d97f2e6872a05d2b6f67bf0cd',
          gnu_build_id: '',
          go_build_id: '',
          arch: 'aarch64',
          symbol_source: 'debug_info',
        },
      ]

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(expectedMetadata.length)
      const metadata = (uploadMultipartHelper as jest.Mock).mock.calls.map((call) => {
        const payload = call[1] as MultipartPayload
        const mappingFileItem = payload.content.get('elf_symbol_file') as MultipartFileValue
        expect(mappingFileItem).toBeTruthy()
        expect(mappingFileItem.options.filename).toBe('elf_symbol_file')

        return JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      })
      const getId = (m: any) => m.gnu_build_id || m.go_build_id || m.file_hash
      metadata.sort((a, b) => getId(a).localeCompare(getId(b)))
      expectedMetadata.sort((a, b) => getId(a).localeCompare(getId(b)))
      expect(metadata).toEqual(expectedMetadata)
      expect(exitCode).toBe(0)
    })

    test('skips upload on dry run', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [fixtureDir]
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
