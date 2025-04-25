import upath from 'upath'

import {createCommand, createMockContext, makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import {SpanTags} from '../../../helpers/interfaces'

import {UploadCodeCoverageReportCommand} from '../upload'

jest.mock('../../../helpers/id', () => jest.fn())

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(UploadCodeCoverageReportCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
  })

  describe('getMatchingCoverageReportFilesByFormat', () => {
    test('should read all xml files and reject invalid ones', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['src/commands/coverage/__tests__/fixtures'],
        automaticReportsDiscovery: true,
        config: {},
        context,
      })
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(3)
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
    })

    test('should read all xml files excluding ignored paths', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['src/commands/coverage/__tests__/fixtures'],
        automaticReportsDiscovery: true,
        ignoredPaths: 'src/commands/coverage/__tests__/fixtures/subfolder.xml',
        config: {},
        context,
      })
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(2)
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
    })

    test('should allow single files', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['src/commands/coverage/__tests__/fixtures/jacoco-report.xml'],
        config: {},
        context,
      })
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(1)

      expect(fileNames[0]).toEqual('src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
    })

    test('should not fail for invalid single files', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['src/commands/coverage/__tests__/fixtures/does-not-exist.xml'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(0)
    })

    test('should allow folder and single unit paths', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: [
          'src/commands/coverage/__tests__/fixtures',
          'src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml',
        ],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(3)
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
    })

    test('should not have repeated files', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: [
          'src/commands/coverage/__tests__/fixtures',
          'src/commands/coverage/__tests__/fixtures/jacoco-report.xml',
        ],
        automaticReportsDiscovery: true,
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(3)
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
    })

    test('should fetch nested folders when using glob patterns', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['**/coverage/**/*.xml'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(3)
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
    })

    test('should fetch nested folders and ignore non xml files', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const result = command['getMatchingCoverageReportFilesByFormat'].call({
        basePaths: ['**/coverage/**'],
        config: {},
        context,
      })

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(3)
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('./src/commands/coverage/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
    })
  })

  describe('getSpanTags', () => {
    test('should parse DD_ENV environment variable', async () => {
      process.env.DD_ENV = 'ci'
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
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
    test('should parse tags argument', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
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

    test('should parse DD_TAGS environment variable', () => {
      process.env.DD_TAGS = 'key1:https://google.com,key2:value2,key3:1234321'
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const spanTags: SpanTags = command['getCustomTags'].call({
        config: {
          envVarTags: process.env.DD_TAGS,
        },
        context,
      })
      expect(spanTags).toMatchObject({
        key1: 'https://google.com',
        key2: 'value2',
        key3: '1234321',
      })
    })

    test('should parse measures argument', () => {
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
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

    test('should parse DD_MEASURES environment variable', () => {
      process.env.DD_MEASURES = 'key1:321,key2:123,key3:321.1,key4:abc,key5:-12.1'
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
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

    test('should ignore DD_MEASURES if a non-numeric value is passed', () => {
      process.env.DD_MEASURES = 'key1:321,key2:abc'
      const context = createMockContext()
      const command = createCommand(UploadCodeCoverageReportCommand)
      const spanTags: SpanTags = command['getCustomMeasures'].call({
        config: {
          envVarMeasures: process.env.DD_MEASURES,
        },
        context,
      })

      expect(spanTags).toMatchObject({})
    })
  })
})

describe('execute', () => {
  const runCLI = makeRunCLI(UploadCodeCoverageReportCommand, ['coverage', 'upload', '--dry-run'])

  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['src/commands/coverage/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/coverage/__tests__/fixtures'],
    })
  })

  test('multiple paths', async () => {
    const {context, code} = await runCLI(['src/commands/coverage/first/', 'src/commands/coverage/second/'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/coverage/first/', 'src/commands/coverage/second/'],
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI([CWD + '/src/commands/coverage/__tests__/fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: [`${CWD}/src/commands/coverage/__tests__/fixtures`],
    })
  })

  test('single file', async () => {
    const {context, code} = await runCLI([CWD + '/src/commands/coverage/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split('\n')
    const path = `${CWD}/src/commands/coverage/__tests__/fixtures/single_file.xml`
    expect(code).toBe(0)
    expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
    expect(output[1]).toContain('Starting upload')
    expect(output[2]).toContain(`Will upload code coverage report file ${path}`)
  })
})

interface ExpectedOutput {
  basePaths: string[]
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
  expect(output[1]).toContain(`Starting upload`)
  expect(output[2]).toContain(`Will look for code coverage report files in ${expected.basePaths.join(', ')}`)
}
