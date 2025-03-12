import os from 'os'

import {Cli} from 'clipanion/lib/advanced'

import {createMockContext} from '../../../helpers/__tests__/fixtures'
import id from '../../../helpers/id'
import {SpanTags} from '../../../helpers/interfaces'

import {renderInvalidFile} from '../renderer'
import {UploadJUnitXMLCommand} from '../upload'

jest.mock('../../../helpers/id', () => jest.fn())

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadJUnitXMLCommand)

  return cli
}

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadJUnitXMLCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
  })
  describe('getMatchingJUnitXMLFiles', () => {
    test('should read all xml files and reject invalid ones', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toBe(2)
      const filePaths = files.map((file) => file.xmlPath)
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/go-report.xml')
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/java-report.xml')

      const output = context.stdout.toString()
      expect(output).toContain(
        renderInvalidFile('src/commands/junit/__tests__/fixtures/empty.xml', 'Start tag expected.')
      )
      expect(output).toContain(
        renderInvalidFile(
          'src/commands/junit/__tests__/fixtures/invalid.xml',
          'Neither <testsuites> nor <testsuite> are the root tag.'
        )
      )
    })
    test('should allow single files', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/go-report.xml'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toEqual(1)

      expect(files[0]).toMatchObject({
        xmlPath: 'src/commands/junit/__tests__/fixtures/go-report.xml',
      })
    })
    test('should not fail for invalid single files', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/does-not-exist.xml'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toEqual(0)
    })
    test('should allow folder and single unit paths', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: [
            'src/commands/junit/__tests__/fixtures',
            'src/commands/junit/__tests__/fixtures/subfolder/js-report.xml',
          ],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      // Check that all expected files are present, regardless of order
      const filePaths = files.map((file) => file.xmlPath)
      expect(filePaths.length).toEqual(3)
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/go-report.xml')
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/java-report.xml')
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/subfolder/js-report.xml')
    })
    test('should allow folders with extensions', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/junit.xml'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toBe(2)
      const filePaths = files.map((file) => file.xmlPath)
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(filePaths).toContain('src/commands/junit/__tests__/fixtures/junit.xml/valid-report.xml')
    })
    test('should not have repeated files', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures', 'src/commands/junit/__tests__/fixtures/go-report.xml'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toEqual(2)
    })
    test('should set hostname', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toBe(2)
      files.forEach((file) => {
        expect(file.hostname).toEqual(os.hostname())
      })
    })
    test('should set logsEnabled for each file', async () => {
      process.env.DD_CIVISIBILITY_LOGS_ENABLED = 'true'
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures'],
          config: {},
          context,
          logs: true,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      expect(files.length).toBe(2)
      files.forEach((file) => {
        expect(file.logsEnabled).toBe(true)
      })
    })
    test('should show different error on no test report', async () => {
      process.env.DD_CIVISIBILITY_LOGS_ENABLED = 'true'
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/subfolder/invalid-no-tests.xml'],
          config: {},
          context,
          logs: true,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )
      const output = context.stdout.toString()
      expect(output).toContain(
        renderInvalidFile(
          'src/commands/junit/__tests__/fixtures/subfolder/invalid-no-tests.xml',
          'The junit report file is empty, there are no <testcase> elements.'
        )
      )
    })
    test('should fetch nested folders', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['**/junit/**/*.xml'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )
      const fileNames = files.map((file) => file.xmlPath)

      expect(fileNames.length).toBe(9)
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/go-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/java-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/junit.xml/valid-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/subfolder/js-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })
    test('should fetch nested folders and ignore non xml files', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['**/junit/**'],
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )
      const fileNames = files.map((file) => file.xmlPath)

      expect(fileNames.length).toBe(9)
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/go-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/java-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/junit.xml/valid-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/subfolder/js-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('./src/commands/junit/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })
    test('should discover junit XML files automatically with recursive search', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/autodiscovery'],
          automaticReportsDiscovery: true,
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      const fileNames = files.map((file) => file.xmlPath)
      expect(fileNames.length).toBe(3)
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
      expect(fileNames).not.toContain('src/commands/junit/__tests__/fixtures/autodiscovery/regular-file.xml')
    })
    test('should discover junit XML files automatically excluding ignored paths', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures/autodiscovery'],
          automaticReportsDiscovery: true,
          ignoredPaths: 'src/commands/junit/__tests__/fixtures/autodiscovery/nested',
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      const fileNames = files.map((file) => file.xmlPath)
      expect(fileNames.length).toBe(2)
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/test-results.xml')
    })
    test('should combine explicit file paths with auto-discovered files', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: [
            'src/commands/junit/__tests__/fixtures/autodiscovery/nested',
            'src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml',
          ],
          automaticReportsDiscovery: true,
          config: {},
          context,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )

      const fileNames = files.map((file) => file.xmlPath)
      expect(fileNames.length).toBe(2)
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/commands/junit/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })
  })
  describe('getSpanTags', () => {
    test('should parse DD_ENV environment variable', async () => {
      process.env.DD_ENV = 'ci'
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
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
      const command = new UploadJUnitXMLCommand()
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
      const command = new UploadJUnitXMLCommand()
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
      const command = new UploadJUnitXMLCommand()
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
      const command = new UploadJUnitXMLCommand()
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
    test('should parse report tags argument', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const spanTags: SpanTags = command['getReportTags'].call({
        config: {},
        context,
        reportTags: ['key1:value1', 'key2:value2'],
      })

      expect(spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
    })
    test('should parse report measures argument', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const spanTags: SpanTags = command['getReportMeasures'].call({
        config: {},
        context,
        reportMeasures: ['key1:20', 'key2:30'],
      })

      expect(spanTags).toMatchObject({
        key1: 20,
        key2: 30,
      })
    })
  })
  describe('parseXPathTags', () => {
    test('should parse xpath assigments', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      const xPathTags = command['parseXPathTags'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures'],
          config: {},
          context,
          service: 'service',
        },
        ['test.suite=/testcase/@classname', "custom_tag=/testcase/..//property[@name='property-name']"]
      )
      expect(xPathTags).toMatchObject({
        'test.suite': '/testcase/@classname',
        custom_tag: "/testcase/..//property[@name='property-name']",
      })
    })
    test('should alert of invalid values', async () => {
      const context = createMockContext()
      const command = new UploadJUnitXMLCommand()
      command['parseXPathTags'].call(
        {
          basePaths: ['src/commands/junit/__tests__/fixtures'],
          config: {},
          context,
          service: 'service',
        },
        ['test.suite=/testcase/@classname', 'invalid']
      )
      const errOutput = context.stderr.toString().split(os.EOL)
      expect(errOutput[0]).toContain('Invalid xpath')
    })
  })
})

describe('execute', () => {
  const runCLI = async (extraArgs: string[]) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(
      ['junit', 'upload', '--service', 'test-service', '--dry-run', '--logs', ...extraArgs],
      context
    )

    return {context, code}
  }
  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['src/commands/junit/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/junit/__tests__/fixtures'],
      concurrency: 20,
      service: 'test-service',
    })
  })
  test('multiple paths', async () => {
    const {context, code} = await runCLI(['src/commands/junit/first/', 'src/commands/junit/second/'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/junit/first/', 'src/commands/junit/second/'],
      concurrency: 20,
      service: 'test-service',
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI([process.cwd() + '/src/commands/junit/__tests__/fixtures'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: [`${process.cwd()}/src/commands/junit/__tests__/fixtures`],
      concurrency: 20,
      service: 'test-service',
    })
  })

  test('single file', async () => {
    const {context, code} = await runCLI([process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split(os.EOL)
    const path = `${process.cwd()}/src/commands/junit/__tests__/fixtures/single_file.xml`
    expect(code).toBe(0)
    expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML')
    expect(output[1]).toContain('Starting upload with concurrency 20.')
    expect(output[2]).toContain(`Will upload jUnit XML file ${path}`)
    expect(output[3]).toContain('service: test-service')
  })

  test('with git metadata without argument (default value is true)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Syncing git metadata')
  })

  test('without git metadata (with argument)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload', // should tolerate the option as a boolean flag
      process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('without git metadata (with argument set to 1)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload=1', // should tolerate the option as a boolean flag
      process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('with git metadata (with argument set to 0)', async () => {
    const {context, code} = await runCLI([
      '--skip-git-metadata-upload=0',
      process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    expect(output[5]).toContain('Syncing git metadata')
  })

  test('id headers are added when git metadata is uploaded', async () => {
    await runCLI([
      '--skip-git-metadata-upload=0',
      process.cwd() + '/src/commands/junit/__tests__/fixtures/single_file.xml',
    ])
    expect(id).toHaveBeenCalled()
  }, 10000000)
})

interface ExpectedOutput {
  basePaths: string[]
  concurrency: number
  service: string
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML')
  expect(output[1]).toContain(`Starting upload with concurrency ${expected.concurrency}.`)
  expect(output[2]).toContain(`Will look for jUnit XML files in ${expected.basePaths.join(', ')}`)
  expect(output[3]).toContain(`service: ${expected.service}`)
}
