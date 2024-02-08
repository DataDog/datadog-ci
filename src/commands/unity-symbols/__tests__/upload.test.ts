import os from 'os'

import {createCommand} from '../../../helpers/__tests__/fixtures'
import {TrackedFilesMatcher, getRepositoryData} from '../../../helpers/git/format-git-sourcemaps-data'
import {MultipartFileValue, MultipartPayload, MultipartStringValue} from '../../../helpers/upload'
import {performSubCommand} from '../../../helpers/utils'
import {version} from '../../../helpers/version'

import * as dsyms from '../../dsyms/upload'

import {uploadMultipartHelper} from '../helpers'
import {renderArgumentMissingError, renderMissingBuildId, renderMissingIL2CPPMappingFile} from '../renderer'
import {UploadCommand} from '../upload'

jest.mock('../../../helpers/utils', () => ({
  ...jest.requireActual('../../../helpers/utils'),
  performSubCommand: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(),
}))

jest.mock('../../../helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('../../../helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

const cliVersion = version

describe('unity-symbols upload', () => {
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

    test('requires build_id file', async () => {
      const {exitCode, context} = await runCommand((_) => {})
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderMissingBuildId('datadogSymbols/build_id'))
    })

    test('uses API Key from env over config from JSON file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = 'src/commands/unity-symbols/__tests__/fixtures/buildIdOnly'
        cmd['configPath'] = 'src/commands/unity-symbols/__tests__/fixtures/config/datadog-ci.json'

        process.env.DATADOG_API_KEY = 'fake_api_key'
      })
      const output = context.stdout.toString().split(os.EOL)

      expect(exitCode).toBe(0)

      expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
      expect(output).toContain('The environment API key ending in _key will be used.')
    })
  })

  describe('dsyms upload', () => {
    // Use a path with only a build_id file to pass parameter validation, but prevent
    // other steps from executing
    const symbolsLocation = 'src/commands/unity-symbols/__tests__/fixtures/buildIdOnly'

    test('calls dsyms sub-command with proper default parameters', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = symbolsLocation
      })

      expect(exitCode).toBe(0)

      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', symbolsLocation, '--max-concurrency', '20'],
        expect.anything()
      )
    })

    test('calls dsyms sub-command with dry-run on dry-run', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = symbolsLocation
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', symbolsLocation, '--max-concurrency', '20', '--dry-run'],
        expect.anything()
      )
    })

    test('calls dsyms sub-command passing through max concurrency', async () => {
      const {exitCode, context: _} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = symbolsLocation
        cmd['maxConcurrency'] = 12
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', symbolsLocation, '--max-concurrency', '12'],
        expect.anything()
      )
    })
  })

  describe('il2cpp mapping upload', () => {
    const mockGitRepoParameters = (command: UploadCommand) => {
      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './Assets/Scripts/Behavior.cs',
          './Assets/Scripts/UIBehavior.cs',
        ]),
      }
    }

    test('warns if mapping file does not exist', async () => {
      const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures/buildIdOnly'
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
      })

      const errorOutput = context.stderr.toString().split(os.EOL)

      // Doesn't fail, only warning
      expect(exitCode).toBe(0)
      expect(errorOutput).toContain(renderMissingIL2CPPMappingFile(`${fixtureDir}/LineNumberMappings.json`))
    })

    test('creates correct metadata payload', async () => {
      const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures/mappingFile'
      const command = createCommand(UploadCommand)
      command['symbolsLocation'] = fixtureDir
      await command['verifyParameters']()

      mockGitRepoParameters(command)

      const metadata = command['getMappingMetadata']()

      expect(metadata).toEqual({
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        build_id: 'fake-build-id',
        type: 'il2cpp_mapping_file',
      })
    })

    test('uploads correct multipart payload with repository', async () => {
      const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures/mappingFile'

      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './Assets/Scripts/Behavior.cs',
          './Assets/Scripts/UIBehavior.cs',
        ]),
      })

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
      })

      const expectedMetadata = {
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        type: 'il2cpp_mapping_file',
        build_id: 'fake-build-id',
      }

      const expectedRepository = {
        data: [
          {
            files: ['./Assets/Scripts/Behavior.cs', './Assets/Scripts/UIBehavior.cs'],
            hash: 'fake-git-hash',
            repository_url: 'fake-git-remote',
          },
        ],
        version: 1,
      }

      expect(uploadMultipartHelper).toHaveBeenCalled()
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value)).toStrictEqual(expectedMetadata)
      const repoValue = payload.content.get('repository') as MultipartStringValue
      expect(JSON.parse(repoValue.value)).toStrictEqual(expectedRepository)
      expect((repoValue?.options).filename).toBe('repository')
      expect((repoValue?.options).contentType).toBe('application/json')
      expect(exitCode).toBe(0)
    })

    test('uploads correct multipart payload without repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures/mappingFile'
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
      })

      const expectedMetadata = {
        cli_version: cliVersion,
        build_id: 'fake-build-id',
        type: 'il2cpp_mapping_file',
      }

      expect(uploadMultipartHelper).toHaveBeenCalled()
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value)).toStrictEqual(expectedMetadata)
      const mappingFileItem = payload.content.get('il2cpp_mapping_file') as MultipartFileValue
      expect(mappingFileItem).toBeTruthy()
      expect(mappingFileItem.options.filename).toBe('LineNumberMappings.json')
      expect(mappingFileItem.path).toBe(`${fixtureDir}/LineNumberMappings.json`)
      expect(exitCode).toBe(0)
    })

    test('skips upload on dry run', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures/mappingFile'
      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocation'] = fixtureDir
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
