// tslint:disable: no-string-literal
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
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadJUnitXMLCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
  })
  describe('getMatchingJUnitXMLFiles', () => {
    test('should read all xml files', () => {
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures']
      command['service'] = 'service'
      expect(command['getMatchingJUnitXMLFiles']()[0]).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/go-report.xml',
      })
      expect(command['getMatchingJUnitXMLFiles']()[1]).toMatchObject({
        service: 'service',
        xmlPath: './src/commands/junit/__tests__/fixtures/java-report.xml',
      })
    })
    test('should read DD_TAGS and DD_ENV environment variables', () => {
      process.env.DD_TAGS = 'key1:value1,key2:value2'
      process.env.DD_ENV = 'ci'
      const command = new UploadJUnitXMLCommand()
      command['basePaths'] = ['./src/commands/junit/__tests__/fixtures']
      command['service'] = 'service'
      expect(command['getMatchingJUnitXMLFiles']()[0].spanTags).toMatchObject({
        env: 'ci',
        key1: 'value1',
        key2: 'value2',
      })
      expect(command['getMatchingJUnitXMLFiles']()[1].spanTags).toMatchObject({
        env: 'ci',
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
