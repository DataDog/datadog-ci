import fs from 'fs'
import os from 'os'
import path from 'path'

import {createCommand} from '../../../helpers/__tests__/fixtures'
import {TrackedFilesMatcher} from '../../../helpers/git/format-git-sourcemaps-data'
import {MultipartFileValue, MultipartPayload, MultipartStringValue, UploadStatus} from '../../../helpers/upload'
import {version} from '../../../helpers/version'

import {ElfClass} from '../elf-constants'
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
const commonMetadata = {
  cli_version: cliVersion,
  origin: 'datadog-ci',
  origin_version: cliVersion,
  type: 'elf_symbol_file',
  overwrite: false,
}

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

    test('should accept elf file with only dynamic symbols if --upload-dynamic-symbols option is passed', async () => {
      const command = createCommand(UploadCommand)
      command['acceptDynamicSymbolTableAsSymbolSource'] = true
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
      let tmpSubDir
      try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elf-tests-'))
        tmpSubDir = fs.mkdtempSync(path.join(tmpDir, 'unreadable-'))
        fs.chmodSync(tmpSubDir, 0o200)
        await expect(command['getElfSymbolFiles'](tmpDir)).resolves.toEqual([])
      } finally {
        if (tmpSubDir) {
          // node 23 fails to remove the directory if it's not readable
          fs.chmodSync(tmpSubDir, 0o700)
        }
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

      const elfFileMatadata = {
        arch: 'x86_64',
        filename: './a/b/c/fake-filename',
        isElf: true,
        littleEndian: true,
        elfClass: ElfClass.ELFCLASS64,
        hasDebugInfo: false,
        hasDynamicSymbolTable: true,
        hasSymbolTable: true,
        hasCode: true,
        gnuBuildId: 'fake-gnu-build-id',
        goBuildId: 'fake-go-build-id',
        fileHash: 'fake-file-hash',
        elfType: 'EXEC',
      }
      const metadata = command['getMappingMetadata'](elfFileMatadata)

      expect(metadata).toEqual({
        ...commonMetadata,
        arch: 'x86_64',
        gnu_build_id: 'fake-gnu-build-id',
        go_build_id: 'fake-go-build-id',
        file_hash: 'fake-file-hash',
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        symbol_source: 'symbol_table',
        filename: 'fake-filename',
      })

      command['replaceExisting'] = true
      const metadataReplaceExisting = command['getMappingMetadata'](elfFileMatadata)

      expect(metadataReplaceExisting).toEqual({...metadata, overwrite: true})
    })

    test('uploads correct multipart payload with multiple locations', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [
          `${fixtureDir}/dyn_aarch64`,
          `${fixtureDir}/exec_aarch64`,
          `${fixtureDir}/go_x86_64_both_gnu_and_go_build_id`,
        ]
        cmd['acceptDynamicSymbolTableAsSymbolSource'] = true
      })

      const expectedMetadata = [
        {
          ...commonMetadata,
          file_hash: 'd19d63194275d385e3dd852b80d5ba7a',
          gnu_build_id: '32cc243a7921912e295d578637cff3a0b8a4c627',
          go_build_id: '',
          arch: 'aarch64',
          filename: 'exec_aarch64',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '5ba2907faebb8002de89711d5f0f005c',
          gnu_build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          go_build_id: '',
          arch: 'aarch64',
          filename: 'dyn_aarch64',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '70c9cab66acf4f5c715119b0999c20a4',
          gnu_build_id: '6a5e565db576fe96acd8ab12bf857eb36f8afdf4',
          go_build_id: 'tUhrGOwxi48kXlLhYlY3/WlmPekR2qonrFvofssLt/8beXJbt0rDaHhn3I6x8D/IA6Zd8Qc8Rsh_bFKoPVn',
          arch: 'x86_64',
          filename: 'go_x86_64_both_gnu_and_go_build_id',
          symbol_source: 'dynamic_symbol_table',
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
          ...commonMetadata,
          file_hash: 'd19d63194275d385e3dd852b80d5ba7a',
          gnu_build_id: '32cc243a7921912e295d578637cff3a0b8a4c627',
          go_build_id: '',
          arch: 'aarch64',
          filename: 'exec_aarch64',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '5ba2907faebb8002de89711d5f0f005c',
          gnu_build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          go_build_id: '',
          arch: 'aarch64',
          filename: 'dyn_aarch64',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '40a0f8378cf61c89c325a397edaa0dd2',
          gnu_build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          go_build_id: '',
          arch: 'x86_64',
          filename: 'dyn_x86_64',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '3c8e0a68a99a3a03836d225a33ac1f8d',
          gnu_build_id: '623209afd6c408f9009e57fad28782f056112daf',
          go_build_id: '',
          arch: 'arm',
          filename: 'exec_arm_big',
          symbol_source: 'debug_info',
        },
        {
          ...commonMetadata,
          file_hash: '708ef04fdf761682c36bc4c062420c37',
          gnu_build_id: '18c30e2d7200682b5ab36c83060c9d6fcd083a3a',
          go_build_id: '',
          arch: 'arm',
          filename: 'exec_arm_little',
          symbol_source: 'symbol_table',
        },
        {
          ...commonMetadata,
          file_hash: 'b3af701d97f2e6872a05d2b6f67bf0cd',
          gnu_build_id: '',
          go_build_id: '',
          arch: 'aarch64',
          filename: 'dyn_aarch64_nobuildid',
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
      const getId = (m: any) => ((m.gnu_build_id || m.go_build_id || m.file_hash) as string) + '-' + (m.arch as string)
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
