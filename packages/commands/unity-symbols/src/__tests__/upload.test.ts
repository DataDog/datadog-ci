import {createCommand} from '../../../helpers/__tests__/testing-tools'
import {TrackedFilesMatcher, getRepositoryData} from '../../../helpers/git/format-git-sourcemaps-data'
import {MultipartFileValue, MultipartPayload, MultipartStringValue, MultipartValue} from '../../../helpers/upload'
import {performSubCommand} from '../../../helpers/utils'
import {version} from '../../../helpers/version'

import * as dsyms from '../../dsyms/upload'

import {uploadMultipartHelper} from '../helpers'
import {
  renderArgumentMissingError,
  renderMissingBuildId,
  renderMissingDir,
  renderMissingIL2CPPMappingFile,
  renderMustSupplyPlatform,
} from '../renderer'
import {UploadCommand} from '../upload'

const cliVersion = version
const fixtureDir = 'src/commands/unity-symbols/__tests__/fixtures'

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

describe('unity-symbols upload', () => {
  const runCommand = async (prepFunction: (command: UploadCommand) => void) => {
    const command = createCommand(UploadCommand)
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context: command.context}
  }

  const mockGitRepoParameters = (command: UploadCommand) => {
    command['gitData'] = {
      hash: 'fake-git-hash',
      remote: 'fake-git-remote',
      trackedFilesMatcher: new TrackedFilesMatcher(['./Assets/Scripts/Behavior.cs', './Assets/Scripts/UIBehavior.cs']),
    }
  }

  test('creates correct metadata payload with arch when supplied', async () => {
    const command = createCommand(UploadCommand)
    command['ios'] = true
    command['symbolsLocation'] = `${fixtureDir}/mappingFile`
    await command['verifyParameters']()

    mockGitRepoParameters(command)

    const metadata = command['getMappingMetadata']('ndk_symbol_file', 'x86_64')

    expect(metadata).toEqual({
      arch: 'x86_64',
      cli_version: cliVersion,
      git_commit_sha: 'fake-git-hash',
      git_repository_url: 'fake-git-remote',
      build_id: 'fake-build-id',
      type: 'ndk_symbol_file',
    })
  })

  describe('parameter validation', () => {
    test('ios fails if symbols-location is blank', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['ios'] = true
        cmd['symbolsLocation'] = ''
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderArgumentMissingError('symbols-location'))
    })

    test('android fails if symbols-location is blank', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['ios'] = true
        cmd['symbolsLocation'] = ''
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderArgumentMissingError('symbols-location'))
    })

    test('default ios symbol location is ./datadogSymbols', async () => {
      let captureCmd: UploadCommand
      const {exitCode} = await runCommand((cmd) => {
        cmd['ios'] = true
        captureCmd = cmd
      })

      expect(exitCode).not.toBe(0)
      expect(captureCmd!['symbolsLocation']).toBe('./datadogSymbols')
    })

    test('default android symbol location is ./unityLibrary/symbols', async () => {
      let captureCmd: UploadCommand
      const {exitCode} = await runCommand((cmd) => {
        cmd['android'] = true
        captureCmd = cmd
      })

      expect(exitCode).not.toBe(0)
      expect(captureCmd!['symbolsLocation']).toBe('./unityLibrary/symbols')
    })

    test('requires platform', async () => {
      const {exitCode, context} = await runCommand((_) => {})

      expect(exitCode).not.toBe(0)

      expect(context.stderr.toString()).toContain(renderMustSupplyPlatform())
    })

    test('uses API Key from env over config from JSON file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['ios'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/buildIdOnly`
        cmd['configPath'] = `${fixtureDir}/config/datadog-ci.json`

        process.env.DATADOG_API_KEY = 'fake_api_key'
      })
      const output = context.stdout.toString().split('\n')

      expect(exitCode).toBe(0)

      expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
      expect(output).toContain('The environment API key ending in _key will be used.')
    })

    test('ios requires build_id file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['ios'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/config`
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderMissingBuildId(`${fixtureDir}/config/build_id`))
    })

    test('android requires build_id file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['android'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/config`
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderMissingBuildId(`${fixtureDir}/config/build_id`))
    })
  })

  describe('dsyms upload', () => {
    // Use a path with only a build_id file to pass parameter validation, but prevent
    // other steps from executing
    const symbolsLocation = `${fixtureDir}/buildIdOnly`

    test('calls dsyms sub-command with proper default parameters', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['ios'] = true
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
        cmd['ios'] = true
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
        cmd['ios'] = true
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

  describe('android so upload', () => {
    test('errors if symbol directory is missing', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['android'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/missing-dir`
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingDir(`${fixtureDir}/missing-dir`))
    })

    const getExpectedMetadata = (arch: string, gitCommitSha?: string, gitRepositoryUrl?: string) => ({
      arch,
      cli_version: cliVersion,
      ...(gitCommitSha && {git_commit_sha: gitCommitSha}),
      ...(gitRepositoryUrl && {git_repository_url: gitRepositoryUrl}),
      build_id: 'fake-build-id',
      type: 'ndk_symbol_file',
    })

    test('uploads correct multipart payloads without repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      await runCommand((cmd) => {
        cmd['android'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/androidSymbols`
      })

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(4)

      // Possible metadata values
      const possibleMetadata = [
        JSON.stringify(getExpectedMetadata('aarch64')),
        JSON.stringify(getExpectedMetadata('arm')),
      ]
      const calls = (uploadMultipartHelper as jest.Mock).mock.calls
      calls.forEach((call) => {
        const content = call[1].content as Map<string, MultipartValue>
        expect(content).toBeTruthy()

        const file = content.get('ndk_symbol_file')
        const baseFilename = file!['options']['filename']
        expect(['libmain.so', 'libunity.so']).toContain(baseFilename)

        expect(possibleMetadata).toContain((content.get('event') as MultipartStringValue).value)
      })
    })

    test('uploads correct multipart payloads with repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher(['./Assets/Scripts/Behavior.cs']),
      })

      await runCommand((cmd) => {
        cmd['android'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/androidSymbols`
      })

      const possibleMetadata = [
        JSON.stringify(getExpectedMetadata('aarch64', 'fake-git-hash', 'fake-git-remote')),
        JSON.stringify(getExpectedMetadata('arm', 'fake-git-hash', 'fake-git-remote')),
      ]

      const expectedRepository = {
        data: [
          {
            files: ['./Assets/Scripts/Behavior.cs'],
            hash: 'fake-git-hash',
            repository_url: 'fake-git-remote',
          },
        ],
        version: 1,
      }

      const calls = (uploadMultipartHelper as jest.Mock).mock.calls
      calls.forEach((call) => {
        const content = call[1].content as Map<string, MultipartValue>
        expect(content).toBeTruthy()

        const file = content.get('ndk_symbol_file')
        const baseFilename = file!['options']['filename']
        expect(['libmain.so', 'libunity.so']).toContain(baseFilename)

        expect(possibleMetadata).toContain((content.get('event') as MultipartStringValue).value)
        const repoValue = content.get('repository') as MultipartStringValue
        expect(JSON.parse(repoValue.value)).toStrictEqual(expectedRepository)
        expect(repoValue.options.filename).toBe('repository')
        expect(repoValue.options.contentType).toBe('application/json')
      })
    })
  })

  describe('il2cpp mapping upload', () => {
    ;['ios', 'android'].forEach((platform) => {
      test(`warns if mapping file does not exist for ${platform}`, async () => {
        const {exitCode, context} = await runCommand((cmd) => {
          ;(cmd as any)[platform] = true
          cmd['symbolsLocation'] = `${fixtureDir}/buildIdOnly`
        })

        const errorOutput = context.stderr.toString()

        // Doesn't fail, only warning
        expect(exitCode).toBe(0)
        expect(errorOutput).toContain(
          renderMissingIL2CPPMappingFile(`${fixtureDir}/buildIdOnly/LineNumberMappings.json`)
        )
      })

      test(`creates correct metadata payload for ${platform}`, async () => {
        const command = createCommand(UploadCommand)
        ;(command as any)[platform] = true
        command['symbolsLocation'] = `${fixtureDir}/mappingFile`
        await command['verifyParameters']()

        mockGitRepoParameters(command)

        const metadata = command['getMappingMetadata']('il2cpp_mapping_file')

        expect(metadata).toEqual({
          cli_version: cliVersion,
          git_commit_sha: 'fake-git-hash',
          git_repository_url: 'fake-git-remote',
          build_id: 'fake-build-id',
          type: 'il2cpp_mapping_file',
        })
      })

      test(`uploads correct multipart payload with repository for ${platform}`, async () => {
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
          ;(cmd as any)[platform] = true
          cmd['symbolsLocation'] = `${fixtureDir}/mappingFile`
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

      test(`uploads correct multipart payload without repository for ${platform}`, async () => {
        ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

        const {exitCode} = await runCommand((cmd) => {
          ;(cmd as any)[platform] = true
          cmd['symbolsLocation'] = `${fixtureDir}/mappingFile`
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
        expect(mappingFileItem.path).toBe(`${fixtureDir}/mappingFile/LineNumberMappings.json`)
        expect(exitCode).toBe(0)
      })
    })

    test('skips upload on dry run', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const {exitCode} = await runCommand((cmd) => {
        cmd['ios'] = true
        cmd['symbolsLocation'] = `${fixtureDir}/mappingFile`
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
