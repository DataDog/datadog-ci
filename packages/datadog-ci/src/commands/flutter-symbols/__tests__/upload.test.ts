import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {TrackedFilesMatcher, getRepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'
import {performSubCommand} from '@datadog/datadog-ci-base/helpers/utils'
import {version} from '@datadog/datadog-ci-base/helpers/version'

import * as dsyms from '../../dsyms/upload'
import * as sourcemaps from '../../sourcemaps/upload'

import {getArchInfoFromFilename, uploadMultipartHelper} from '../helpers'
import {
  renderInvalidPubspecError,
  renderInvalidSymbolsDir,
  renderMinifiedPathPrefixRequired,
  renderMissingAndroidMappingFile,
  renderMissingDartSymbolsDir,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
  renderVersionBuildNumberWarning,
} from '../renderer'
import {UploadCommand} from '../upload'

jest.mock('@datadog/datadog-ci-base/helpers/utils', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/utils'),
  performSubCommand: jest.fn(),
}))

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(),
}))

const cliVersion = version
const fixtureDir = './src/commands/flutter-symbols/__tests__/fixtures'

describe('flutter-symbol upload', () => {
  const runCommand = async (prepFunction: (command: UploadCommand) => void) => {
    const command = createCommand(UploadCommand)
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context: command.context}
  }

  describe('parameter validation', () => {
    test('fails if no service name given', async () => {
      const {exitCode, context} = await runCommand((_) => {})
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('Error')
      expect(errorOutput).toContain('"service-name" is required')
    })

    test('requires valid pubspec', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingPubspecError('./pubspec.yaml'))
    })

    test('uses API Key from env over config from JSON file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['configPath'] = 'src/commands/flutter-symbols/__tests__/fixtures/config/datadog-ci.json'
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0+114'

        process.env.DATADOG_API_KEY = 'fake_api_key'
      })
      const output = context.stdout.toString().split('\n')

      expect(exitCode).toBe(0)

      expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
      expect(output).toContain('The environment API key ending in _key will be used.')
    })

    test('version bypasses pubspec check', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0+114'
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
    })

    test('minified-path-prefix required if web-sourcemaps is specified', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0+114'
        cmd['webSourceMaps'] = true
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderMinifiedPathPrefixRequired())
    })

    test('minified-path-prefix required if web-sourcemaps-location is specified', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0+114'
        cmd['webSourceMapsLocation'] = './fake/location'
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderMinifiedPathPrefixRequired())
    })
  })

  describe('getFlutterSymbolFiles', () => {
    test('should read all symbol files', async () => {
      const command = new UploadCommand()
      const searchDir = `${fixtureDir}/dart-symbols`
      const files = command['getFlutterSymbolFiles'](searchDir)

      expect(files).toEqual([
        `${searchDir}/app.ios-arm64.symbols`,
        `${searchDir}/app.android-x64.symbols`,
        `${searchDir}/app.android-arm64.symbols`,
        `${searchDir}/app.android-arm.symbols`,
      ])
    })
  })

  describe('parsePubspec', () => {
    test('writes error on missing pubspec', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion']('./pubspec.yaml')

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderMissingPubspecError('./pubspec.yaml'))
    })

    test('writes error on invalid pubspec', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion'](`${fixtureDir}/pubspecs/invalidPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderInvalidPubspecError(`${fixtureDir}/pubspecs/invalidPubspec.yaml`))
    })

    test('writes error on missing version in pubspec', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion'](`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderPubspecMissingVersionError(`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`))
    })

    test('populates version from valid pubspec', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion'](`${fixtureDir}/pubspecs/validPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
      expect(command['version']).toBe('1.2.3')
    })

    test('strips pre-release from pre-release pubspec and shows warning', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion'](`${fixtureDir}/pubspecs/prereleasePubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe(renderVersionBuildNumberWarning(`${fixtureDir}/pubspecs/prereleasePubspec.yaml`))
      expect(command['version']).toBe('1.2.3')
    })

    test('strips build from build pubspec and shows warning', async () => {
      const command = createCommand(UploadCommand)
      const context = command.context
      const exitCode = await command['parsePubspecVersion'](`${fixtureDir}/pubspecs/buildPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe(renderVersionBuildNumberWarning(`${fixtureDir}/pubspecs/buildPubspec.yaml`))
      expect(command['version']).toBe('1.2.3')
    })
  })

  describe('dsyms upload', () => {
    test('calls dsyms sub-command with proper default parameters', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0'
        cmd['iosDsyms'] = true
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', './build/ios/archive/Runner.xcarchive/dSYMs'],
        expect.anything()
      )
    })

    test('calls dsyms sub-command with dry-run on dry-run', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0'
        cmd['iosDsyms'] = true
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', './build/ios/archive/Runner.xcarchive/dSYMs', '--dry-run'],
        expect.anything()
      )
    })

    test('calls dsyms sub-command passing through dsymLocation', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0'
        cmd['iosDsymsLocation'] = './dsym-location'
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', './dsym-location'],
        expect.anything()
      )
      expect(errorOutput).toBe('')
    })
  })

  describe('android mapping upload', () => {
    const addDefaultCommandParameters = (command: UploadCommand) => {
      command['serviceName'] = 'fake.service'
      command['version'] = '1.0.0'
    }

    const mockGitRepoParameters = (command: UploadCommand) => {
      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './lib/main.dart',
          './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
          './ios/Runner/AppDelegate.swift',
        ]),
      }
    }

    test('errors if mapping file does not exist', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['androidMappingLocation'] = `${fixtureDir}/android/missing.txt`
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingAndroidMappingFile(`${fixtureDir}/android/missing.txt`))
    })

    test('errors if default mapping file does not exist', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['androidMapping'] = true
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingAndroidMappingFile('./build/app/outputs/mapping/release/mapping.txt'))
    })

    test('creates correct metadata payload', () => {
      const command = createCommand(UploadCommand)
      addDefaultCommandParameters(command)
      mockGitRepoParameters(command)

      const metadata = command['getAndroidMetadata']()

      expect(metadata).toEqual({
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        service: 'fake.service',
        type: 'jvm_mapping_file',
        variant: 'release',
        version: '1.0.0',
      })
    })

    test('build in version is sanitized in metadata payload', () => {
      const command = createCommand(UploadCommand)
      addDefaultCommandParameters(command)
      mockGitRepoParameters(command)
      command['version'] = '1.2.4+987'

      const metadata = command['getAndroidMetadata']()

      expect(metadata).toEqual({
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        service: 'fake.service',
        type: 'jvm_mapping_file',
        variant: 'release',
        version: '1.2.4-987',
      })
    })

    test('uploads correct multipart payload without repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['androidMappingLocation'] = `${fixtureDir}/android/fake-mapping.txt`
      })

      const expectedMetadata = {
        cli_version: cliVersion,
        service: 'fake.service',
        type: 'jvm_mapping_file',
        variant: 'release',
        version: '1.0.0',
      }

      expect(uploadMultipartHelper).toHaveBeenCalled()
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value)).toStrictEqual(expectedMetadata)
      const mappingFileItem = payload.content.get('jvm_mapping_file') as MultipartFileValue
      expect(mappingFileItem).toBeTruthy()
      expect(mappingFileItem.options.filename).toBe('jvm_mapping')
      expect(mappingFileItem.path).toBe(`${fixtureDir}/android/fake-mapping.txt`)
      expect(exitCode).toBe(0)
    })

    test('uploads correct multipart payload with repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './lib/main.dart',
          './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
          './ios/Runner/AppDelegate.swift',
        ]),
      })

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['androidMappingLocation'] = `${fixtureDir}/android/fake-mapping.txt`
      })

      const expectedMetadata = {
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        service: 'fake.service',
        type: 'jvm_mapping_file',
        variant: 'release',
        version: '1.0.0',
      }

      const expectedRepository = {
        data: [
          {
            files: [
              './lib/main.dart',
              './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
              './ios/Runner/AppDelegate.swift',
            ],
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

    test('skips upload on dry run', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['androidMappingLocation'] = `${fixtureDir}/android/fake-mapping.txt`
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })

  describe('web symbols upload', () => {
    test('calls sourcemap sub-command with proper default parameters', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.2.3'
        cmd['webSourceMaps'] = true
        cmd['minifiedPathPrefix'] = 'https://localhost'
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        sourcemaps.UploadCommand,
        [
          'sourcemaps',
          'upload',
          './build/web',
          '--service=fake.service',
          '--release-version=1.2.3',
          '--minified-path-prefix=https://localhost',
        ],
        expect.anything()
      )
    })

    test('calls sourcemap sub-command with overridden location', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.2.3'
        cmd['webSourceMaps'] = true
        cmd['webSourceMapsLocation'] = './other/location'
        cmd['minifiedPathPrefix'] = 'https://localhost'
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        sourcemaps.UploadCommand,
        [
          'sourcemaps',
          'upload',
          './other/location',
          '--service=fake.service',
          '--release-version=1.2.3',
          '--minified-path-prefix=https://localhost',
        ],
        expect.anything()
      )
    })

    test('calls sourcemap sub-command with location only', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.2.3'
        cmd['webSourceMapsLocation'] = './other/location'
        cmd['minifiedPathPrefix'] = 'https://localhost'
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        sourcemaps.UploadCommand,
        [
          'sourcemaps',
          'upload',
          './other/location',
          '--service=fake.service',
          '--release-version=1.2.3',
          '--minified-path-prefix=https://localhost',
        ],
        expect.anything()
      )
    })

    test('calls sourcemap sub-command with dry-run', async () => {
      const {exitCode} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.2.3'
        cmd['webSourceMaps'] = true
        cmd['minifiedPathPrefix'] = 'https://localhost'
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        sourcemaps.UploadCommand,
        [
          'sourcemaps',
          'upload',
          './build/web',
          '--service=fake.service',
          '--release-version=1.2.3',
          '--minified-path-prefix=https://localhost',
          '--dry-run',
        ],
        expect.anything()
      )
    })
  })

  describe('flutter symbol upload', () => {
    const addDefaultCommandParameters = (command: UploadCommand) => {
      command['serviceName'] = 'fake.service'
      command['version'] = '1.0.0'
    }

    const mockGitRepoParameters = (command: UploadCommand) => {
      command['gitData'] = {
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './lib/main.dart',
          './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
          './ios/Runner/AppDelegate.swift',
        ]),
      }
    }

    test('errors if symbol directory is missing', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['dartSymbolsLocation'] = `${fixtureDir}/missing-dir`
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingDartSymbolsDir(`${fixtureDir}/missing-dir`))
    })

    test('errors if symbol directory is a file', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['dartSymbolsLocation'] = `${fixtureDir}/dart-symbols/app.android-arm.symbols`
      })

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderInvalidSymbolsDir(`${fixtureDir}/dart-symbols/app.android-arm.symbols`))
    })

    test('creates correct metadata payloads', () => {
      const command = createCommand(UploadCommand)
      addDefaultCommandParameters(command)
      mockGitRepoParameters(command)

      const metadata = command['getFlutterMetadata']('ios', 'arm64')

      expect(metadata).toEqual({
        arch: 'arm64',
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        platform: 'ios',
        service: 'fake.service',
        type: 'flutter_symbol_file',
        variant: 'release',
        version: '1.0.0',
      })
    })

    test('sanitizes build in version number payload', () => {
      const command = createCommand(UploadCommand)
      addDefaultCommandParameters(command)
      mockGitRepoParameters(command)
      command['version'] = '1.2.4+567'

      const metadata = command['getFlutterMetadata']('ios', 'arm64')

      expect(metadata).toEqual({
        arch: 'arm64',
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        platform: 'ios',
        service: 'fake.service',
        type: 'flutter_symbol_file',
        variant: 'release',
        version: '1.2.4-567',
      })
    })

    test('parses symbol filenames into platform / arch', () => {
      const info1 = getArchInfoFromFilename('app.android-arm.symbols')
      const info2 = getArchInfoFromFilename('./a/directory/app.android-x64.symbols')
      const info3 = getArchInfoFromFilename('./a/directory/app.confusing-.ios-arm64.symbols')
      const info4 = getArchInfoFromFilename('app.bad.symbols')

      expect(info1).toEqual({platform: 'android', arch: 'arm'})
      expect(info2).toEqual({platform: 'android', arch: 'x64'})
      expect(info3).toEqual({platform: 'ios', arch: 'arm64'})
      expect(info4).toBeUndefined()
    })

    const getExpectedMetadata = (
      platform: string,
      arch: string,
      gitCommitSha?: string,
      gitRespositoryUrl?: string
    ) => ({
      arch,
      cli_version: cliVersion,
      ...(gitCommitSha && {git_commit_sha: gitCommitSha}),
      ...(gitRespositoryUrl && {git_repository_url: gitRespositoryUrl}),
      platform,
      service: 'fake.service',
      type: 'flutter_symbol_file',
      variant: 'release',
      version: '1.0.0',
    })

    test('uploads correct multipart payloads without repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['dartSymbolsLocation'] = `${fixtureDir}/dart-symbols`
      })

      const expectedMetadatas = [
        getExpectedMetadata('android', 'arm'),
        getExpectedMetadata('android', 'arm64'),
        getExpectedMetadata('android', 'x64'),
        getExpectedMetadata('ios', 'arm64'),
      ]

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(4)
      expectedMetadatas.forEach((expectedMetadata) => {
        const mockCalls = (uploadMultipartHelper as jest.Mock).mock.calls
        const index = mockCalls.findIndex((call) => {
          const checkPayload = call[1] as MultipartPayload
          const eventPayload = (checkPayload.content.get('event') as MultipartStringValue).value

          return eventPayload === JSON.stringify(expectedMetadata)
        })
        // Ensure the metadata matches at least one call
        expect(index).not.toBe(-1)
        const payload = mockCalls[index][1] as MultipartPayload
        const mappingFileItem = payload.content.get('flutter_symbol_file') as MultipartFileValue
        expect(mappingFileItem).toBeTruthy()
        expect(mappingFileItem.options.filename).toBe('flutter_symbol_file')
        const expectedPath = `${fixtureDir}/dart-symbols/app.${expectedMetadata.platform}-${expectedMetadata.arch}.symbols`
        expect(mappingFileItem.path).toBe(expectedPath)
      })

      expect(exitCode).toBe(0)
    })

    test('uploads correct multipart payloads with repository', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher([
          './lib/main.dart',
          './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
          './ios/Runner/AppDelegate.swift',
        ]),
      })

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['dartSymbolsLocation'] = `${fixtureDir}/dart-symbols`
      })

      const expectedMetadatas = [
        getExpectedMetadata('android', 'arm', 'fake-git-hash', 'fake-git-remote'),
        getExpectedMetadata('android', 'arm64', 'fake-git-hash', 'fake-git-remote'),
        getExpectedMetadata('android', 'x64', 'fake-git-hash', 'fake-git-remote'),
        getExpectedMetadata('ios', 'arm64', 'fake-git-hash', 'fake-git-remote'),
      ]

      const expectedRepository = {
        data: [
          {
            files: [
              './lib/main.dart',
              './android/app/src/main/kotlin/com/datadoghq/example/flutter/MainActivity.kt',
              './ios/Runner/AppDelegate.swift',
            ],
            hash: 'fake-git-hash',
            repository_url: 'fake-git-remote',
          },
        ],
        version: 1,
      }

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(4)
      expectedMetadatas.forEach((expectedMetadata) => {
        const mockCalls = (uploadMultipartHelper as jest.Mock).mock.calls
        const index = mockCalls.findIndex((call) => {
          const checkPayload = call[1] as MultipartPayload
          const eventPayload = (checkPayload.content.get('event') as MultipartStringValue).value

          return eventPayload === JSON.stringify(expectedMetadata)
        })
        // Ensure the metadata matches at least one call
        expect(index).not.toBe(-1)
        const payload = mockCalls[index][1] as MultipartPayload
        const repoValue = payload.content.get('repository') as MultipartStringValue
        expect(JSON.parse(repoValue.value)).toStrictEqual(expectedRepository)
        expect(repoValue.options.filename).toBe('repository')
        expect(repoValue.options.contentType).toBe('application/json')
        expect(exitCode).toBe(0)
      })

      expect(exitCode).toBe(0)
    })

    test('skips upload on dry run', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValueOnce('')

      const {exitCode} = await runCommand((cmd) => {
        addDefaultCommandParameters(cmd)
        cmd['dartSymbolsLocation'] = `${fixtureDir}/dart-symbols`
        cmd['dryRun'] = true
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(exitCode).toBe(0)
    })
  })
})
