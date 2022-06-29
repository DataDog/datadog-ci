import {Cli} from 'clipanion/lib/advanced'
import {UploadCommand} from '../upload'
import * as dsyms from '../../dsyms/upload'

const mockExecute = jest.fn()
jest.mock('../../dsyms/upload', () => {
  return {
    UploadCommand: jest.fn().mockImplementation(() => {
      return {
        execute: mockExecute,
      }
    }),
  }
})

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
    }
  }

  const runCli = async (args: string[]) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const exitCode = await cli.run(['flutter-symbols', 'upload', ...args, '--dry-run'], context)

    return {context, exitCode}
  }

  describe('parameter validation', () => {
    test('fails if no service name given', async () => {
      const {context, exitCode} = await runCli([])
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('Error')
      expect(errorOutput).toContain('"service-name" is required')
    })

    test('dart-symbols requires dart-symbols-location', async () => {
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--dart-symbols'])
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('Error')
      expect(errorOutput).toContain('"--dart-symbols" requires specifying "--dart-symbol-location"')
    })
  })

  describe('dsyms upload', () => {
    test('calls dsyms sub-command with proper parameters', async () => {
      const {context, exitCode} = await runCli(['--service-name', 'fake.service', '--ios-dsyms'])

      const errorOutput = context.stderr.toString()

      expect(exitCode).toBe(0)
      expect(dsyms.UploadCommand).toHaveBeenCalledTimes(1)
      expect(mockExecute).toHaveBeenCalledTimes(1)
    })
  })
})
