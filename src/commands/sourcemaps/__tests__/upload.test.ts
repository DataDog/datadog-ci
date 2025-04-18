import os from 'os'

import chalk from 'chalk'
import {Cli} from 'clipanion'

import {createMockContext, getEnvVarPlaceholders} from '../../../helpers/__tests__/testing-tools'

import {Sourcemap} from '../interfaces'
import {UploadCommand} from '../upload'

describe('upload', () => {
  describe('getMinifiedURL', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = 'http://datadog.com/js'
      expect(command['getMinifiedURLAndRelativePath']('/js/sourcemaps/common.min.js.map')).toStrictEqual([
        'http://datadog.com/js/common.min.js.map',
        '/common.min.js.map',
      ])
    })
  })

  describe('getMinifiedURL: minifiedPathPrefix has the protocol omitted', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = '//datadog.com/js'
      expect(command['getMinifiedURLAndRelativePath']('/js/sourcemaps/common.min.js.map')).toStrictEqual([
        '//datadog.com/js/common.min.js.map',
        '/common.min.js.map',
      ])
    })
  })

  describe('getMinifiedURL: minifiedPathPrefix is an absolute path', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = '/js'
      expect(command['getMinifiedURLAndRelativePath']('/js/sourcemaps/common.min.js.map')).toStrictEqual([
        '/js/common.min.js.map',
        '/common.min.js.map',
      ])
    })
  })

  describe('isMinifiedPathPrefixValid: full URL', () => {
    test('should return true', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = 'http://datadog.com/js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(true)
    })
  })

  describe('isMinifiedPathPrefixValid: URL without protocol', () => {
    test('should return true', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = '//datadog.com/js'

      expect(command['isMinifiedPathPrefixValid']()).toBe(true)
    })
  })

  describe('isMinifiedPathPrefixValid: leading slash', () => {
    test('should return true', () => {
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

  describe('isMinifiedPathPrefixValid: invalid URL without host', () => {
    test('should return false', () => {
      const command = new UploadCommand()
      command['minifiedPathPrefix'] = 'info: undesired log line\nhttps://example.com/static/js/'

      expect(command['isMinifiedPathPrefixValid']()).toBe(false)
    })
  })

  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const command = new UploadCommand()

      expect(command['getRequestBuilder'].bind(command)).toThrow(
        `Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`
      )
    })
  })

  describe('addRepositoryDataToPayloads', () => {
    test('repository url and commit still defined without payload', async () => {
      const command = new UploadCommand()
      const write = jest.fn()
      command.context = {stdout: {write}} as any
      const sourcemaps = new Array<Sourcemap>(
        new Sourcemap(
          'src/commands/sourcemaps/__tests__/fixtures/sourcemap-with-no-files/empty.min.js',
          'http://example/empty.min.js',
          'src/commands/sourcemaps/__tests__/fixtures/sourcemap-with-no-files/empty.min.js.map',
          '',
          ''
        )
      )
      // The command will fetch git metadatas for the current datadog-ci repository.
      // The `empty.min.js.map` contains no files, therefore no file payload should be set.
      await command['addRepositoryDataToPayloads'](sourcemaps)
      expect(sourcemaps[0].gitData).toBeDefined()
      expect(sourcemaps[0].gitData!.gitRepositoryURL).toBeDefined()
      expect(sourcemaps[0].gitData!.gitCommitSha).toHaveLength(40)
      expect(sourcemaps[0].gitData!.gitRepositoryPayload).toBeUndefined()
    })

    test('should include payload', async () => {
      const command = new UploadCommand()
      const write = jest.fn()
      command.context = {stdout: {write}} as any
      const sourcemaps = new Array<Sourcemap>(
        new Sourcemap(
          'src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js',
          'http://example/common.min.js',
          'src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map',
          '',
          ''
        )
      )
      // The command will fetch git metadatas for the current datadog-ci repository.
      // The `common.min.js.map` contains the "git.test.ts" filename which matches a tracked filename,
      // therefore a file payload should be set.
      // Removing the "git.test.ts" file will break this test.
      await command['addRepositoryDataToPayloads'](sourcemaps)
      expect(sourcemaps[0].gitData).toBeDefined()
      expect(sourcemaps[0].gitData!.gitRepositoryURL).toBeDefined()
      expect(sourcemaps[0].gitData!.gitCommitSha).toHaveLength(40)
      expect(sourcemaps[0].gitData!.gitRepositoryPayload).toBeDefined()
    })
  })
})

describe('execute', () => {
  const runCLI = async (path: string) => {
    const cli = new Cli()
    cli.register(UploadCommand)

    const context = createMockContext()
    process.env = getEnvVarPlaceholders()

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
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/doesnotexist/../fixtures/basic')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: 'src/commands/sourcemaps/__tests__/fixtures/basic',
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: ['src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map'],
      version: '1234',
    })
  })

  test('relative path', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures/basic')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: 'src/commands/sourcemaps/__tests__/fixtures/basic',
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: ['src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map'],
      version: '1234',
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI(process.cwd() + '/src/commands/sourcemaps/__tests__/fixtures/basic')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      basePath: `${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures/basic`,
      concurrency: 20,
      jsFilesURLs: ['https://static.com/js/common.min.js'],
      minifiedPathPrefix: 'https://static.com/js',
      projectPath: '',
      service: 'test-service',
      sourcemapsPaths: [`${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures/basic/common.min.js.map`],
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

  test('all files are skipped', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures/stdout-output/all-skipped')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    output.reverse()
    expect(output[3]).toContain('Some sourcemaps have been skipped')
    expect(output[2]).toContain('Details about the 2 found sourcemaps:')
    expect(output[1]).toContain('  * 2 sourcemaps were skipped')
  })

  test('mix of skipped filed and correct files', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures/stdout-output/mixed')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    output.reverse()
    expect(output[4]).toContain('Some sourcemaps have been skipped')
    expect(output[3]).toContain('Details about the 3 found sourcemaps:')
    expect(output[2]).toContain('  * 2 sourcemaps successfully uploaded')
    expect(output[1]).toContain('  * 1 sourcemap was skipped')
  })

  test('completely empty sourcemap should be skipped', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures/empty-file/')
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    output.reverse()
    expect(output[3]).toContain('Some sourcemaps have been skipped')
    expect(output[2]).toContain('Details about the 2 found sourcemaps:')
    expect(output[1]).toContain('  * 2 sourcemaps were skipped')
  })
})

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
  const uploadedFileLines = output.slice(5, -4)
  expect(expected.sourcemapsPaths.length).toEqual(uploadedFileLines.length) // Safety check
  expect(expected.jsFilesURLs.length).toEqual(uploadedFileLines.length) // Safety check
  uploadedFileLines.forEach((_, index) => {
    expect(uploadedFileLines[index]).toContain(
      `[DRYRUN] Uploading sourcemap ${expected.sourcemapsPaths} for JS file available at ${expected.jsFilesURLs}`
    )
  })
  if (uploadedFileLines.length > 1) {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemaps with success`)
  } else {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemap with success`)
  }
}
