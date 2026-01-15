import os from 'os'

import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import id from '@datadog/datadog-ci-base/helpers/id'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import upath from 'upath'

import {PluginCommand as JunitUploadCommand} from '../commands/upload'
import {renderInvalidFile} from '../renderer'

jest.mock('@datadog/datadog-ci-base/helpers/id', () => jest.fn())

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(JunitUploadCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
  })
  describe('getMatchingJUnitXMLFiles', () => {
    test('should read all xml files and reject invalid ones', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures'],
          config: {},
          context: command.context,
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
      expect(filePaths).toContain('src/__tests__/fixtures/go-report.xml')
      expect(filePaths).toContain('src/__tests__/fixtures/java-report.xml')

      const output = command.context.stdout.toString()
      expect(output).toContain(renderInvalidFile('src/__tests__/fixtures/empty.xml', 'Start tag expected.'))
      expect(output).toContain(
        renderInvalidFile(
          'src/__tests__/fixtures/invalid.xml',
          'Neither <testsuites> nor <testsuite> are the root tag.'
        )
      )
    })

    test('should allow single files', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/go-report.xml'],
          config: {},
          context: command.context,
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
        xmlPath: 'src/__tests__/fixtures/go-report.xml',
      })
    })

    test('should not fail for invalid single files', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/does-not-exist.xml'],
          config: {},
          context: command.context,
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
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures', 'src/__tests__/fixtures/subfolder/js-report.xml'],
          config: {},
          context: command.context,
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
      expect(filePaths).toContain('src/__tests__/fixtures/go-report.xml')
      expect(filePaths).toContain('src/__tests__/fixtures/java-report.xml')
      expect(filePaths).toContain('src/__tests__/fixtures/subfolder/js-report.xml')
    })

    test('should allow folders with extensions', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/junit.xml'],
          config: {},
          context: command.context,
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
      expect(filePaths).toContain('src/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(filePaths).toContain('src/__tests__/fixtures/junit.xml/valid-report.xml')
    })

    test('should not have repeated files', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures', 'src/__tests__/fixtures/go-report.xml'],
          config: {},
          context: command.context,
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
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures'],
          config: {},
          context: command.context,
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
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures'],
          config: {},
          context: command.context,
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
      const command = createCommand(JunitUploadCommand)
      await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/subfolder/invalid-no-tests.xml'],
          config: {},
          context: command.context,
          logs: true,
          service: 'service',
        },
        {},
        {},
        {},
        {},
        {}
      )
      const output = command.context.stdout.toString()
      expect(output).toContain(
        renderInvalidFile(
          'src/__tests__/fixtures/subfolder/invalid-no-tests.xml',
          'The junit report file is empty, there are no <testcase> elements.'
        )
      )
    })

    test('should fetch nested folders', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['**/*.xml'],
          config: {},
          context: command.context,
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
      expect(fileNames).toContain('./src/__tests__/fixtures/go-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/java-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/junit.xml/valid-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder/js-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })

    test('should fetch nested folders and ignore non xml files', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['**'],
          config: {},
          context: command.context,
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
      expect(fileNames).toContain('./src/__tests__/fixtures/go-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/java-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/junit.xml/valid-report-2.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/junit.xml/valid-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder/js-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })

    test('should discover junit XML files automatically with recursive search', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/autodiscovery'],
          automaticReportsDiscovery: true,
          config: {},
          context: command.context,
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
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/test-results.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
      expect(fileNames).not.toContain('src/__tests__/fixtures/autodiscovery/regular-file.xml')
    })

    test('should discover junit XML files automatically excluding ignored paths', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: ['src/__tests__/fixtures/autodiscovery'],
          automaticReportsDiscovery: true,
          ignoredPaths: 'src/__tests__/fixtures/autodiscovery/nested',
          config: {},
          context: command.context,
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
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/test-results.xml')
    })

    test('should combine explicit file paths with auto-discovered files', async () => {
      const command = createCommand(JunitUploadCommand)
      const files = await command['getMatchingJUnitXMLFiles'].call(
        {
          basePaths: [
            'src/__tests__/fixtures/autodiscovery/nested',
            'src/__tests__/fixtures/autodiscovery/junit-report.xml',
          ],
          automaticReportsDiscovery: true,
          config: {},
          context: command.context,
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
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/junit-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/autodiscovery/nested/TEST-suite.xml')
    })
  })
  describe('getSpanTags', () => {
    test('should parse DD_ENV environment variable', async () => {
      process.env.DD_ENV = 'ci'
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = await command['getSpanTags'].call({
        config: {
          env: process.env.DD_ENV,
        },
        context: command.context,
      })
      expect(spanTags).toMatchObject({
        env: 'ci',
      })
    })
  })
  describe('parseCustomTags', () => {
    test('should parse tags argument', async () => {
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getCustomTags'].call({
        config: {},
        context: command.context,
        tags: ['key1:value1', 'key2:value2'],
      })

      expect(spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
    })

    test('should parse DD_TAGS environment variable', async () => {
      process.env.DD_TAGS = 'key1:https://google.com,key2:value2'
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getCustomTags'].call({
        config: {
          envVarTags: process.env.DD_TAGS,
        },
        context: command.context,
      })
      expect(spanTags).toMatchObject({
        key1: 'https://google.com',
        key2: 'value2',
      })
    })

    test('should parse measures argument', async () => {
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getCustomMeasures'].call({
        config: {},
        context: command.context,
        measures: ['key1:10', 'key2:20'],
      })

      expect(spanTags).toMatchObject({
        key1: 10,
        key2: 20,
      })
    })

    test('should parse DD_MEASURES environment variable', async () => {
      process.env.DD_MEASURES = 'key1:321,key2:123,key3:321.1,key4:abc,key5:-12.1'
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getCustomMeasures'].call({
        config: {
          envVarMeasures: process.env.DD_MEASURES,
        },
        context: command.context,
      })

      expect(spanTags).toMatchObject({
        key1: 321,
        key2: 123,
        key3: 321.1,
        key5: -12.1,
      })
    })

    test('should parse report tags argument', async () => {
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getReportTags'].call({
        config: {},
        context: command.context,
        reportTags: ['key1:value1', 'key2:value2'],
      })

      expect(spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
    })

    test('should parse report measures argument', async () => {
      const command = createCommand(JunitUploadCommand)
      const spanTags: SpanTags = command['getReportMeasures'].call({
        config: {},
        context: command.context,
        reportMeasures: ['key1:20', 'key2:30'],
      })

      expect(spanTags).toMatchObject({
        key1: 20,
        key2: 30,
      })
    })
  })
  describe('parseXPathTags', () => {
    test('should parse xpath assignments', async () => {
      const command = createCommand(JunitUploadCommand)
      const xPathTags = command['parseXPathTags'].call(
        {
          basePaths: ['src/__tests__/fixtures'],
          config: {},
          context: command.context,
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
      const command = createCommand(JunitUploadCommand)
      command['parseXPathTags'].call(
        {
          basePaths: ['src/__tests__/fixtures'],
          config: {},
          context: command.context,
          service: 'service',
        },
        ['test.suite=/testcase/@classname', 'invalid']
      )
      const errOutput = command.context.stderr.toString().split('\n')
      expect(errOutput[0]).toContain('Invalid xpath')
    })
  })
})

describe('execute', () => {
  const runCLI = makeRunCLI(JunitUploadCommand, ['junit', 'upload', '--service', 'test-service', '--dry-run', '--logs'])

  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['src/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/__tests__/fixtures'],
      concurrency: 20,
      service: 'test-service',
    })
  })

  test('multiple paths', async () => {
    const {context, code} = await runCLI(['src/first/', 'src/second/'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/first/', 'src/second/'],
      concurrency: 20,
      service: 'test-service',
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: [`${CWD}/src/__tests__/fixtures`],
      concurrency: 20,
      service: 'test-service',
    })
  })

  test('single file', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split('\n')
    const path = `${CWD}/src/__tests__/fixtures/single_file.xml`
    expect(code).toBe(0)
    expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML')
    expect(output[1]).toContain('Starting upload with concurrency 20.')
    expect(output[2]).toContain(`Will upload jUnit XML file ${path}`)
    expect(output[3]).toContain('service: test-service')
  })

  test('with git metadata without argument (default value is true)', async () => {
    const {context, code} = await runCLI(['--verbose', CWD + '/src/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split('\n')
    expect(id).toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Syncing git metadata')
  })

  test('without git metadata (with argument)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload', // should tolerate the option as a boolean flag
      CWD + '/src/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split('\n')
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('without git metadata (with argument set to 1)', async () => {
    const {context, code} = await runCLI([
      '--verbose',
      '--skip-git-metadata-upload=1', // should tolerate the option as a boolean flag
      CWD + '/src/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split('\n')
    expect(id).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(output[5]).toContain('Not syncing git metadata (skip git upload flag detected)')
  })

  test('with git metadata (with argument set to 0)', async () => {
    const {context, code} = await runCLI([
      '--skip-git-metadata-upload=0',
      CWD + '/src/__tests__/fixtures/single_file.xml',
    ])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    expect(output[5]).toContain('Syncing git metadata')
  })

  test('id headers are added when git metadata is uploaded', async () => {
    await runCLI(['--skip-git-metadata-upload=0', CWD + '/src/__tests__/fixtures/single_file.xml'])
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
