import os from 'os'

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
    test('fails if symbols-location is blank', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = ''
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderArgumentMissingError('symbols-location'))
    })

    test('fails if symbols-location is does not exist', async () => {
      const nonExistentSymbolsLocation = `${fixtureDir}/does-not-exist`
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = nonExistentSymbolsLocation
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderInvalidSymbolsLocation(nonExistentSymbolsLocation))
    })

    test('uses API Key from env over config from JSON file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['configPath'] = `${fixtureDir}/config/datadog-ci.json`
        cmd['symbolsLocation'] = fixtureDir
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
        `${fixtureDir}/dyn_aarch64`,
        `${fixtureDir}/dyn_aarch64.debug`,
        `${fixtureDir}/dyn_x86_64`,
        `${fixtureDir}/exec_aarch64`,
        `${fixtureDir}/exec_arm_big`,
        `${fixtureDir}/exec_arm_little`,
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
  })

  describe('upload', () => {
    test('creates correct metadata payload', async () => {
      const command = createCommand(UploadCommand)
      command['symbolsLocation'] = fixtureDir

      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([]),
      }

      const metadata = command['getMappingMetadata']('fake-build-id', 'x86_64')

      expect(metadata).toEqual({
        arch: 'x86_64',
        build_id: 'fake-build-id',
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        platform: 'elf',
        type: 'elf_symbol_file',
      })
    })

    test('uploads correct multipart payload without repository', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
      })

      const expectedMetadata = [
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          build_id: '32cc243a7921912e295d578637cff3a0b8a4c627',
          arch: 'aarch64',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          build_id: '90aef8b4a3cd45d758501e49d1d9844736c872cd',
          arch: 'aarch64',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          build_id: 'a8ac08faa0d114aa65f1ee0730af38903ac506de',
          arch: 'x86_64',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          build_id: '623209afd6c408f9009e57fad28782f056112daf',
          arch: 'arm',
        },
        {
          cli_version: cliVersion,
          platform: 'elf',
          type: 'elf_symbol_file',
          build_id: '18c30e2d7200682b5ab36c83060c9d6fcd083a3a',
          arch: 'arm',
        },
      ]

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(5)
      const metadata = (uploadMultipartHelper as jest.Mock).mock.calls.map((call) => {
        const payload = call[1] as MultipartPayload
        const mappingFileItem = payload.content.get('elf_symbol_file') as MultipartFileValue
        expect(mappingFileItem).toBeTruthy()
        expect(mappingFileItem.options.filename).toBe('elf_symbol_file')

        return JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      })
      metadata.sort((a, b) => a.build_id.localeCompare(b.build_id))
      expectedMetadata.sort((a, b) => a.build_id.localeCompare(b.build_id))
      expect(metadata).toEqual(expectedMetadata)
      expect(exitCode).toBe(0)
    })

    test('skips upload on dry run', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
