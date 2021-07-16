// tslint:disable: no-string-literal
import chalk from 'chalk'
import {Cli} from 'clipanion/lib/advanced'
import os from 'os'

import {UploadJUnitXMLCommand} from '../upload'

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadJUnitXMLCommand)

  return cli
}

const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key and --apiKey are undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadJUnitXMLCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toEqual(
        `Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment and --apiKey was not passed.\n`
      )
    })
  })
  describe('getMatchingJUnitXMLFiles', () => {
    test('should read all xml files', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures']
      command['service'] = 'service'
      const [firstFile, secondFile] = await command['getMatchingJUnitXMLFiles']()

      expect(firstFile).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/go-report.xml',
      })
      expect(secondFile).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/java-report.xml',
      })
    })
    test('should allow single files', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures/go-report.xml']
      command['service'] = 'service'
      const files = await command['getMatchingJUnitXMLFiles']()
      expect(files.length).toEqual(1)

      expect(files[0]).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/go-report.xml',
      })
    })
    test('should not fail for invalid single files', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures/does-not-exist.xml']
      command['service'] = 'service'
      const files = await command['getMatchingJUnitXMLFiles']()
      expect(files.length).toEqual(0)
    })
    test('should allow folder and single unit paths', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = [
        './src/commands/junit/__tests__/fixtures',
        './src/commands/junit/__tests__/fixtures/subfolder/js-report.xml',
      ]
      command['service'] = 'service'
      const [firstFile, secondFile, thirdFile] = await command['getMatchingJUnitXMLFiles']()
      expect(firstFile).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/go-report.xml',
      })
      expect(secondFile).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/java-report.xml',
      })
      expect(thirdFile).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/subfolder/js-report.xml',
      })
    })
    test('should not have repeated files', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = [
        './src/commands/junit/__tests__/fixtures',
        './src/commands/junit/__tests__/fixtures/go-report.xml',
      ]
      command['service'] = 'service'
      const files = await command['getMatchingJUnitXMLFiles']()
      expect(files.length).toEqual(2)
    })
    test('should parse DD_TAGS and DD_ENV environment variables', async () => {
      process.env.DD_TAGS = 'key1:value1,key2:value2'
      process.env.DD_ENV = 'ci'
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures']
      command['service'] = 'service'
      const [firstFile, secondFile] = await command['getMatchingJUnitXMLFiles']()
      expect(firstFile.spanTags).toMatchObject({
        env: 'ci',
        key1: 'value1',
        key2: 'value2',
      })
      expect(secondFile.spanTags).toMatchObject({
        env: 'ci',
        key1: 'value1',
        key2: 'value2',
      })
    })
    test('should parse tags argument', async () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures']
      command['tags'] = ['key1:value1', 'key2:value2']
      const [firstFile, secondFile] = await command['getMatchingJUnitXMLFiles']()
      expect(firstFile.spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
      expect(secondFile.spanTags).toMatchObject({
        key1: 'value1',
        key2: 'value2',
      })
    })
  })
})

describe('execute', () => {
  const runCLI = async (paths: string[]) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(['junit', 'upload', '--service', 'test-service', '--dry-run', ...paths], context)

    return {context, code}
  }
  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['./src/commands/junit/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePaths: ['src/commands/junit/__tests__/fixtures'],
      concurrency: 20,
      service: 'test-service',
    })
  })
  test('multiple paths', async () => {
    const {context, code} = await runCLI(['./src/commands/junit/first/', './src/commands/junit/second/'])
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
