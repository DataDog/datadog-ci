// tslint:disable: no-string-literal
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
        'test',
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

    const output = context.stdout.toString().split('\n').slice(0, -2)
    expect(code).toBe(0)
    expect(output).toEqual(
      ['\u001b[33m\u001b[1m\u001b[32m⚠️\u001b[33m\u001b[22m DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\u001b[39m',
        '\u001b[33m\u001b[39m\u001b[32mStarting upload with concurrency 20. \u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mWill look for sourcemaps in src/commands/sourcemaps/__tests__/fixtures\u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mWill match JS files for errors on files starting with https://static.com/js\u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mversion: test service: test-service project path: \u001b[39m',
        '\u001b[32m\u001b[39m[DRYRUN] Uploading sourcemap src/commands/sourcemaps/__tests__/fixtures/common.min.js.map for JS file available at https://static.com/js/common.min.js',
      ])
  })

  test('relative path', async () => {
    const {context, code} = await runCLI('./src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split('\n').slice(0, -2)
    expect(code).toBe(0)
    expect(output).toEqual(
      ['\u001b[33m\u001b[1m\u001b[32m⚠️\u001b[33m\u001b[22m DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\u001b[39m',
        '\u001b[33m\u001b[39m\u001b[32mStarting upload with concurrency 20. \u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mWill look for sourcemaps in src/commands/sourcemaps/__tests__/fixtures\u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mWill match JS files for errors on files starting with https://static.com/js\u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mversion: test service: test-service project path: \u001b[39m',
        '\u001b[32m\u001b[39m[DRYRUN] Uploading sourcemap src/commands/sourcemaps/__tests__/fixtures/common.min.js.map for JS file available at https://static.com/js/common.min.js',
      ])
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI(process.cwd() + '/src/commands/sourcemaps/__tests__/fixtures')
    const output = context.stdout.toString().split('\n').slice(0, -2)
    expect(code).toBe(0)
    expect(output).toEqual(
      ['\u001b[33m\u001b[1m\u001b[32m⚠️\u001b[33m\u001b[22m DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS\u001b[39m',
        '\u001b[33m\u001b[39m\u001b[32mStarting upload with concurrency 20. \u001b[39m',
        `\u001b[32m\u001b[39m\u001b[32mWill look for sourcemaps in ${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures\u001b[39m`,
        '\u001b[32m\u001b[39m\u001b[32mWill match JS files for errors on files starting with https://static.com/js\u001b[39m',
        '\u001b[32m\u001b[39m\u001b[32mversion: test service: test-service project path: \u001b[39m',
        `\u001b[32m\u001b[39m[DRYRUN] Uploading sourcemap ${process.cwd()}/src/commands/sourcemaps/__tests__/fixtures/common.min.js.map for JS file available at https://static.com/js/common.min.js`,
      ])
  })
})
