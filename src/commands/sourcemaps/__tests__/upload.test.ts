// tslint:disable: no-string-literal
import os from 'os'

import {Cli} from 'clipanion/lib/advanced'
import {UploadCommand} from '../upload'

describe('upload', () => {
  describe('getMinifiedURL', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = 'http://datadog.com/js'
      expect(command['getMinifiedURL']('/js/sourcemaps/common.min.js.map')).toBe(
        'http://datadog.com/js/common.min.js.map'
      )
    })
  })

  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
  })
})

describe('execute', () => {
  async function runCLI(path: string) {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
    const code = await cli.run(
      [
        'sourcemaps',
        'upload',
        path,
        '--release-version',
        '1234',
        '--service',
        'test-service',
        '--minified-path-prefix',
        'https://static.com/js',
        '--dry-run',
      ],
      context
    )

    return {context, code}
  }

  test('relative path with double dots', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/doesnotexist/../fixtures')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(
      output,
      20,
      'src/commands/sourcemaps/__tests__/fixtures',
      'https://static.com/js',
      '1234',
      'test-service',
      '',
      ['src/commands/sourcemaps/__tests__/fixtures/common.min.js.map'],
      ['https://static.com/js/common.min.js']
    )
  })

  test('relative path', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(
      output,
      20,
      'src/commands/sourcemaps/__tests__/fixtures',
      'https://static.com/js',
      '1234',
      'test-service',
      '',
      ['src/commands/sourcemaps/__tests__/fixtures/common.min.js.map'],
      ['https://static.com/js/common.min.js']
    )
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI(process.cwd() + '/src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(
      output,
      20,
      `${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures`,
      'https://static.com/js',
      '1234',
      'test-service',
      '',
      [`${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures/common.min.js.map`],
      ['https://static.com/js/common.min.js']
    )
  })
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadCommand)

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

const checkConsoleOutput = (
  output: string[],
  concurrency: number,
  basePath: string,
  minifiedPathPrefix: string,
  version: string,
  service: string,
  projectPath: string,
  sourcemapsPaths: string[],
  jsFilesURLs: string[]
) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS')
  expect(output[1]).toContain(`Starting upload with concurrency ${concurrency}.`)
  expect(output[2]).toContain(`Will look for sourcemaps in ${basePath}`)
  expect(output[3]).toContain(`Will match JS files for errors on files starting with ${minifiedPathPrefix}`)
  expect(output[4]).toContain(`version: ${version} service: ${service} project path: ${projectPath}`)
  const uploadedFileLines = output.slice(5, -2)
  expect(sourcemapsPaths.length).toEqual(uploadedFileLines.length) // Safety check
  expect(jsFilesURLs.length).toEqual(uploadedFileLines.length) // Safety check
  uploadedFileLines.forEach((_, index) => {
    expect(uploadedFileLines[index]).toContain(
      `[DRYRUN] Uploading sourcemap ${sourcemapsPaths} for JS file available at ${jsFilesURLs}`
    )
  })
  expect(output.slice(-2, -1)[0]).toContain(`Uploaded ${uploadedFileLines.length} files`)
}
