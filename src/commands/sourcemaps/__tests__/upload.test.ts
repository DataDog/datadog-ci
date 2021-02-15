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

  describe('getMinifiedURL: minifiedPathPrefix has the protocol omitted', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = '//datadog.com/js'
      expect(command['getMinifiedURL']('/js/sourcemaps/common.min.js.map')).toBe('//datadog.com/js/common.min.js.map')
    })
  })

  describe('getMinifiedURL: minifiedPathPrefix is an absolute path', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = '/js'
      expect(command['getMinifiedURL']('/js/sourcemaps/common.min.js.map')).toBe('/js/common.min.js.map')
    })
  })

  describe('isMinifiedPathPrefixValid: full URL', () => {
    test('should return false', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = 'http://datadog.com/js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(true)
    })
  })

  describe('isMinifiedPathPrefixValid: URL without protocol', () => {
    test('should return false', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = '//datadog.com/js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(true)
    })
  })

  describe('isMinifiedPathPrefixValid: leading slash', () => {
    test('should return false', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = '/js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(true)
    })
  })

  describe('isMinifiedPathPrefixValid: no leading slash', () => {
    test('should return false', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = 'js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(false)
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
  const runCLI = async (path: string) => {
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
    checkConsoleOutput(output, {
      basePath: 'src/commands/sourcemaps/__tests__/fixtures',
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: ['src/commands/sourcemaps/__tests__/fixtures/common.min.js.map'],
      version: '1234',
    })
  })

  test('relative path', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: 'src/commands/sourcemaps/__tests__/fixtures',
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: ['src/commands/sourcemaps/__tests__/fixtures/common.min.js.map'],
      version: '1234',
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI(process.cwd() + '/src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: `${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures`,
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: [`${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures/common.min.js.map`],
      version: '1234',
    })
  })

  test('using the mjs extension', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/mjs')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: 'src/commands/sourcemaps/__tests__/mjs',
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.mjs'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: ['src/commands/sourcemaps/__tests__/mjs/common.mjs.map'],
      version: '1234',
    })
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

interface ExpectedOutput {
  basePath: string
  concurrency: number
  jsFilesURLs: string[]
  minifiedPathPrefix: string
  projectPath: string
  service: string
  sourcemapsPaths: string[]
  version: string
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS')
  expect(output[1]).toContain(`Starting upload with concurrency ${expected.concurrency}.`)
  expect(output[2]).toContain(`Will look for sourcemaps in ${expected.basePath}`)
  expect(output[3]).toContain(`Will match JS files for errors on files starting with ${expected.minifiedPathPrefix}`)
  expect(output[4]).toContain(
    `version: ${expected.version} service: ${expected.service} project path: ${expected.projectPath}`
  )
  const uploadedFileLines = output.slice(5, -2)
  expect(expected.sourcemapsPaths.length).toEqual(uploadedFileLines.length) // Safety check
  expect(expected.jsFilesURLs.length).toEqual(uploadedFileLines.length) // Safety check
  uploadedFileLines.forEach((_, index) => {
    expect(uploadedFileLines[index]).toContain(
      `[DRYRUN] Uploading sourcemap ${expected.sourcemapsPaths} for JS file available at ${expected.jsFilesURLs}`
    )
  })
  expect(output.slice(-2, -1)[0]).toContain(`Uploaded ${uploadedFileLines.length} files`)
}
