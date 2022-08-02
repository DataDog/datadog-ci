import {Cli} from 'clipanion/lib/advanced'
import {performSubCommand} from '../../../helpers/utils'
import {UploadCommand} from '../upload'
import * as dsyms from '../..//dsyms/upload'
import {
  renderDartSymbolsLocationRequiredError,
  renderInvalidPubspecError,
  renderMissingAndroidMappingFile,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
} from '../renderer'

jest.mock('../../../helpers/utils', () => ({
  ...jest.requireActual('../../../helpers/utils'),
  performSubCommand: jest.fn(),
}))

const cliVersion = require('../../../../package.json').version
const fixtureDir = './src/commands/flutter-symbols/__tests__/fixtures'

describe('flutter-symbol upload', () => {
  beforeAll(() => {
    jest.resetAllMocks()
  })

  const makeCli = () => {
    const cli = new Cli()
    cli.register(UploadCommand)

    return cli
  }

  const createMockContext = () => {
    let outString = ''
    let errString = ''

    return {
      stdout: {
        toString: () => outString,
        write: (input: string) => {
          outString += input
        },
      },
      stderr: {
        toString: () => errString,
        write: (input: string) => {
          errString += input
        },
      },
      stdin: {},
    }
  }

  const runCli = async (args: string[]) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const exitCode = await cli.run(['flutter-symbols', 'upload', ...args, '--dry-run'], context)

    return {context, exitCode}
  }

  const prepareMockGlobalsForCommand = (command: UploadCommand) => {
    command['serviceName'] = 'fake.service'
    command['version'] = '1.0.0'
    // command['gitData'] = {
    //   gitCommitSha: 'fake.commit.sha',
    //   gitRepositoryURL: 'fake.git.repo',
    // }
  }

  describe('parameter validation', () => {
    test('fails if no service name given', async () => {
      const {context, exitCode} = await runCli([])
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('Error')
      expect(errorOutput).toContain('"service-name" is required')
    })

    test('requires valid pubspec', async () => {
      // Default location doesn't exist
      const {context, exitCode} = await runCli(['--service-name', 'fake.service'])
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingPubspecError('./pubspec.yaml'))
    })

    test('version bypasses pubspec check', async () => {
      // Default location doesn't exist
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--version', '1.0.0'])
      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
    })

    test('dart-symbols requires dart-symbols-location', async () => {
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--dart-symbols'])
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
      command['context'] = context
      const exitCode = await command['parsePubspec']('./pubspec.yaml')

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderMissingPubspecError('./pubspec.yaml'))
    })

    test('writes error on invalid pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command['context'] = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/invalidPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderInvalidPubspecError(`${fixtureDir}/pubspecs/invalidPubspec.yaml`))
    })

    test('writes error on missing version in pubspec', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command['context'] = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(1)
      expect(errorOutput).toBe(renderPubspecMissingVersionError(`${fixtureDir}/pubspecs/missingVersionPubspec.yaml`))
    })

    test('populates version from valid pubsepct', async () => {
      const context = createMockContext() as any
      const command = new UploadCommand()
      command['context'] = context
      const exitCode = await command['parsePubspec'](`${fixtureDir}/pubspecs/validPubspec.yaml`)

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
      expect(command['version']).toBe('1.2.3-test1')
    })
  })

  describe('dsyms upload', () => {
    test('calls dsyms sub-command with proper default parameters', async () => {
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--ios-dsyms', '--version', '1.0.0'])

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', './build/ios/archive/Runner.xcarchive/dSYMs', '--dry-run'],
        expect.anything()
      )
    })

    test('calls dsyms sub-command passing through dsymLocation', async () => {
      const {context, exitCode} = await runCli([
        '--service-name',
        'fake.service',
        '--ios-dsyms-location',
        './dsym-location',
        '--version',
        '1.0.0',
      ])

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(performSubCommand).toHaveBeenCalledWith(
        dsyms.UploadCommand,
        ['dsyms', 'upload', './dsym-location', '--dry-run'],
        expect.anything()
      )
      expect(errorOutput).toBe('')
    })
  })

  describe('android mapping upload', () => {
    test('errors if mapping file does not exist', async () => {
      const {context, exitCode} = await runCli([
        '--service-name',
        'fake.service',
        '--android-mapping-location',
        `${fixtureDir}/android/missing.txt`,
      ])

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingAndroidMappingFile(`${fixtureDir}/android/missing.txt`))
    })

    test('errors if default mapping file does not exist', async () => {
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--android-mapping'])

      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toBe(renderMissingAndroidMappingFile(`./build/app/outputs/mapping/release/mapping.txt`))
    })

    test('creates correct metadata payload', () => {
      const context = createMockContext()
      const command = new UploadCommand()
      prepareMockGlobalsForCommand(command)

      const metadata = command['getAndroidMetadata']()

      expect(metadata).toStrictEqual({
        cli_version: cliVersion,
        service: 'fake.service',
        version: '1.0.0',
        variant: 'release',
        type: 'jvm_mapping_file',
      })
    })
  })

  describe('flutter symbol upload', () => {})

  describe('combined upload', () => {})
})
