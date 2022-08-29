// tslint:disable: no-string-literal
import FormData from 'form-data'
import {ReadStream} from 'fs'
import {TrackedFilesMatcher} from '../../../helpers/git/format-git-sourcemaps-data'
import {getRepositoryData} from '../../../helpers/git/format-git-sourcemaps-data'
import {MultipartPayload} from '../../../helpers/upload'
import {performSubCommand} from '../../../helpers/utils'
import * as dsyms from '../..//dsyms/upload'
import {uploadMultipartHelper} from '../helpers'
import {
  renderDartSymbolsLocationRequiredError,
  renderInvalidPubspecError,
  renderMissingAndroidMappingFile,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
} from '../renderer'
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

// tslint:disable-next-line:no-var-requires
const cliVersion = require('../../../../package.json').version
const fixtureDir = './src/commands/flutter-symbols/__tests__/fixtures'

describe('flutter-symbol upload', () => {
  beforeAll(() => {
    jest.clearAllMocks()
  })

  const createMockContext = () => {
    let outString = ''
    let errString = ''

    return {
      stderr: {
        toString: () => errString,
        write: (input: string) => {
          errString += input
        },
      },
      stdin: {},
      stdout: {
        toString: () => outString,
        write: (input: string) => {
          outString += input
        },
      },
    }
  }

  const runCommand = async (prepFunction: (command: UploadCommand) => void) => {
    const command = new UploadCommand()
    const context = createMockContext() as any
    command.context = context
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context}
  }

  describe('parameter validation', () => {
    test('fails if no service name given', async () => {
      // tslint:disable-next-line:no-empty
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

    test('version bypasses pubspec check', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0'
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
    })

    test('dart-symbols requires dart-symbols-location', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['serviceName'] = 'fake.service'
        cmd['version'] = '1.0.0'
        cmd['dartSymbols'] = true
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderDartSymbolsLocationRequiredError())
    })
  })

  describe('getFlutterSymbolFiles', () => {
    test('should read all symbol files', async () => {
      const command = new UploadCommand()
      const searchDir = `${fixtureDir}/dart-symbols`
      const files = command['getFlutterSymbolFiles'](searchDir)

      expect(files).toEqual([
        `${searchDir}/app.android-arm.symbols`,
        `${searchDir}/app.android-arm64.symbols`,
        `${searchDir}/app.android-x64.symbols`,
        `${searchDir}/app.ios-arm64.symbols`,
      ])
    })
  })

  describe('parsePubspec', () => {
    test('writes error on missing pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command.context = context
      const exitCode = await command['parsePubspec']('./pubspec.yaml')

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderMissingPubspecError('./pubspec.yaml'))
    })

    test('writes error on invalid pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command.context = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/invalidPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderInvalidPubspecError(`${fixtureDir}/pubspecs/invalidPubspec.yaml`))
    })

    test('writes error on missing version in pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command.context = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderPubspecMissingVersionError(`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`))
    })

    test('populates version from valid pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command.context = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/validPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
      expect(command['version']).toBe('1.2.3-test1')
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
      const command = new UploadCommand()
      addDefaultCommandParameters(command)
      mockGitRepoParameters(command)

      const metadata = command['getAndroidMetadata']()

      expect(metadata).toStrictEqual({
        cli_version: cliVersion,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
        service: 'fake.service',
        type: 'jvm_mapping_file',
        variant: 'release',
        version: '1.0.0',
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
      expect(JSON.parse(payload.content.get('event')?.value as string)).toStrictEqual(expectedMetadata)
      const mappingFileItem = payload.content.get('jvm_mapping_file')
      expect(mappingFileItem).toBeTruthy()
      expect((mappingFileItem?.options as FormData.AppendOptions).filename).toBe('mapping.txt')
      expect(mappingFileItem?.value).toBeInstanceOf(ReadStream)
      expect((mappingFileItem?.value as ReadStream).path).toBe(`${fixtureDir}/android/fake-mapping.txt`)
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
      expect(JSON.parse(payload.content.get('event')?.value as string)).toStrictEqual(expectedMetadata)
      const repoValue = payload.content.get('repository')
      expect(JSON.parse(repoValue?.value as string)).toStrictEqual(expectedRepository)
      expect((repoValue?.options as FormData.AppendOptions).filename).toBe('repository')
      expect((repoValue?.options as FormData.AppendOptions).contentType).toBe('application/json')
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

  // TODO: describe('flutter symbol upload', () => {})

  // TODO: describe('combined upload', () => {})
})
