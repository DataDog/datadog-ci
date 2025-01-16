import os from 'os'

import {Cli} from 'clipanion'

import {createMockContext} from '../../../helpers/__tests__/fixtures'
import id from '../../../helpers/id'
import {SpanTags} from '../../../helpers/interfaces'

import {renderInvalidFile} from '../renderer'
import {UploadCodeCoverageReportCommand} from '../upload'

jest.mock('../../../helpers/id', () => jest.fn())

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadCodeCoverageReportCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
  })
  describe('getMatchingCoverageReportFilesByFormat', () => {
    test('should read all xml files and reject invalid ones', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['./src/commands/coverage/__tests__/fixtures'],
        config: {},
        context,
      })
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames[0]).toEqual('./src/commands/coverage/__tests__/fixtures/another-jacoco-report.xml')
      expect(fileNames[1]).toEqual('./src/commands/coverage/__tests__/fixtures/jacoco-report.xml')

      const output = context.stdout.toString()
      expect(output).toContain(
        renderInvalidFile(
          './src/commands/coverage/__tests__/fixtures/invalid-jacoco-report.xml',
          "Unclosed tag 'report'."
        )
      )
      expect(output).toContain(
        renderInvalidFile(
          './src/commands/coverage/__tests__/fixtures/random-file.xml',
          'Could not detect format of ./src/commands/coverage/__tests__/fixtures/random-file.xml, please specify the format manually using the --format option'
        )
      )
    })
    test('should allow single files', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['./src/commands/coverage/__tests__/fixtures/jacoco-report.xml'],
        config: {},
        context,
      })
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(1)

      expect(fileNames[0]).toEqual('./src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
    })
    test('should not fail for invalid single files', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['./src/commands/coverage/__tests__/fixtures/does-not-exist.xml'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(0)
    })
    test('should allow folder and single unit paths', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: [
          './src/commands/coverage/__tests__/fixtures',
          './src/commands/coverage/__tests__/fixtures/subfolder/nested-jacoco-report.xml',
        ],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames[0]).toEqual('./src/commands/coverage/__tests__/fixtures/another-jacoco-report.xml')
      expect(fileNames[1]).toEqual('./src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames[2]).toEqual('./src/commands/coverage/__tests__/fixtures/subfolder/nested-jacoco-report.xml')
    })
    test('should not have repeated files', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: [
          './src/commands/coverage/__tests__/fixtures',
          './src/commands/coverage/__tests__/fixtures/jacoco-report.xml',
        ],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(2)
    })
    test('should fetch nested folders', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['**/coverage/**/*.xml'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames).toEqual([
        'src/commands/coverage/__tests__/fixtures/another-jacoco-report.xml',
        'src/commands/coverage/__tests__/fixtures/jacoco-report.xml',
        'src/commands/coverage/__tests__/fixtures/subfolder/nested-jacoco-report.xml',
      ])
    }, 10000)
    test('should fetch nested folders and ignore non xml files', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['**/coverage/**'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames).toEqual([
        'src/commands/coverage/__tests__/fixtures/another-jacoco-report.xml',
        'src/commands/coverage/__tests__/fixtures/jacoco-report.xml',
        'src/commands/coverage/__tests__/fixtures/subfolder/nested-jacoco-report.xml',
      ])
    }, 10000)
  })
  describe('getSpanTags', () => {
    test('should parse DD_ENV environment variable', async () => {
      process.env.DD_ENV = 'ci'
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const spanTags: SpanTags = await command['getSpanTags'].call({
        config: {
          env: process.env.DD_ENV,
        },
        context,
      })
      expect(spanTags).toMatchObject({
        env: 'ci',
      })
    })
  })
  describe('parseCustomTags', () => {
    test('should parse tags argument', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const spanTags: SpanTags = command['getCustomTags'].call({
        config: {},
        context,
        tags: ['key1:value1', 'key2:value2'],
      })

      expect(spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
    })
    test('should parse DD_TAGS environment variable', async () => {
      process.env.DD_TAGS = 'key1:https://google.com,key2:value2'
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const spanTags: SpanTags = command['getCustomTags'].call({
        config: {
          envVarTags: process.env.DD_TAGS,
        },
        context,
      })
      expect(spanTags).toMatchObject({
        key1: 'https://google.com',
        key2: 'value2',
      })
    })
    test('should parse measures argument', async () => {
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const spanTags: SpanTags = command['getCustomMeasures'].call({
        config: {},
        context,
        measures: ['key1:10', 'key2:20'],
      })

      expect(spanTags).toMatchObject({
        key1: 10,
        key2: 20,
      })
    })
    test('should parse DD_MEASURES environment variable', async () => {
      process.env.DD_MEASURES = 'key1:321,key2:123,key3:321.1,key4:abc,key5:-12.1'
      const context = createMockContext()
      const command = new UploadCodeCoverageReportCommand()
      const spanTags: SpanTags = command['getCustomMeasures'].call({
        config: {
          envVarMeasures: process.env.DD_MEASURES,
        },
        context,
      })

      expect(spanTags).toMatchObject({
        key1: 321,
        key2: 123,
        key3: 321.1,
        key5: -12.1,
      })
    })
  })
})

describe('execute', () => {
  const runCLI = async (extraArgs: string[]) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(['coverage', 'upload', '--dry-run', ...extraArgs], context)

    return {context, code}
  }
  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['./src/commands/coverage/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/coverage/__tests__/fixtures'],
    })
  })
  test('multiple paths', async () => {
    const {context, code} = await runCLI(['./src/commands/coverage/first/', './src/commands/coverage/second/'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/coverage/first/', 'src/commands/coverage/second/'],
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI([process.cwd() + '/src/commands/coverage/__tests__/fixtures'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: [`${process.cwd()}/src/commands/coverage/__tests__/fixtures`],
    })
  })

  test('single file', async () => {
    const {context, code} = await runCLI([process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split(os.EOL)
    const path = `${process.cwd()}/src/commands/coverage/__tests__/fixtures/single_file.xml`
    expect(code).toBe(0)
    expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
    expect(output[1]).toContain('Starting upload')
    expect(output[2]).toContain(`Will upload code coverage report file ${path}`)
  })

  test('with git metadata without argument (default value is true)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[4]).toContain('Syncing git metadata')
  })

  test('without git metadata (with argument)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload', // should tolerate the option as a boolean flag
      process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[4]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('without git metadata (with argument set to 1)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload=1', // should tolerate the option as a boolean flag
      process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[4]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('with git metadata (with argument set to 0)', async () => {
    const {context, code} = await runCLI([
      '--skip-git-metadata-upload=0',
      process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    expect(output[4]).toContain('Syncing git metadata')
  })

  test('id headers are added when git metadata is uploaded', async () => {
    await runCLI([
      '--skip-git-metadata-upload=0',
      process.cwd() + '/src/commands/coverage/__tests__/fixtures/single_file.xml',
    ])
    expect(id).toHaveBeenCalled()
  }, 10000000)
})

interface ExpectedOutput {
  basePaths: string[]
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
  expect(output[1]).toContain(`Starting upload`)
  expect(output[2]).toContain(`Will look for code coverage report files in ${expected.basePaths.join(', ')}`)
}

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadCodeCoverageReportCommand)

  return cli
}
