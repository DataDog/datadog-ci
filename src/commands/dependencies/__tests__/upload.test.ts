import {default as axios} from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import os from 'os'

import {BaseContext, Cli} from 'clipanion/lib/advanced'
import FormData from 'form-data'
import {Readable, Writable} from 'stream'
import {UploadCommand} from '../upload'

describe('execute', () => {
  test('runs with --dry-run option', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([''])
    expect(sdtout[0]).toEqual(
      chalk.yellow(`${chalk.bold.green('⚠️')} DRY-RUN MODE ENABLED. WILL NOT UPLOAD DEPENDENCIES`)
    )
    expect(sdtout[1]).toEqual(chalk.green('Starting upload.'))
    expect(sdtout[2]).toEqual(
      chalk.green('Will upload dependencies from src/commands/dependencies/__tests__/fixtures/dependencies file.')
    )
    expect(sdtout[3]).toEqual('version: 1.234 service: my-service')
    expect(sdtout[4]).toEqual('[DRYRUN] Uploading dependencies')
    expect(sdtout[5]).toEqual(expect.stringContaining('Uploaded dependencies in'))

    expect(code).toBe(0)
  })

  test('exits if missing api key', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.`, ''])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing app key', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.`, ''])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing --release-version option', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        service: 'my-service',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([`Missing ${chalk.red.bold('--release-version')} parameter.`, ''])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing --service option', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([`Missing ${chalk.red.bold('--service')} parameter.`, ''])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing --source option', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([`Missing ${chalk.red.bold('--source')} parameter.`, ''])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if invalid --source option', async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'unknown-source',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([
      `Unsupported ${chalk.red.bold('--source')} unknown-source. Supported sources are: ${chalk.green.bold('snyk')}`,
      '',
    ])
    expect(sdtout).toEqual([''])

    expect(code).toBe(1)
  })

  test("exits if file doesn't exist", async () => {
    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/unknown-dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([
      'Cannot find "src/commands/dependencies/__tests__/fixtures/unknown-dependencies" file.',
      '',
    ])
    expect(sdtout).toEqual([''])

    expect(code).toBe(2)
  })

  test('makes a valid API request', async () => {
    const request = jest.fn(() => Promise.resolve())
    ;(axios.create as jest.Mock).mockImplementation(() => request)

    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )

    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([''])
    expect(sdtout[0]).toEqual(chalk.green('Starting upload.'))
    expect(sdtout[1]).toEqual(
      chalk.green('Will upload dependencies from src/commands/dependencies/__tests__/fixtures/dependencies file.')
    )
    expect(sdtout[2]).toEqual('version: 1.234 service: my-service')
    expect(sdtout[3]).toEqual('Uploading dependencies')
    expect(sdtout[4]).toEqual(expect.stringContaining('Uploaded dependencies in'))

    expect(code).toBe(0)

    expect(axios.create).toHaveBeenCalledWith({
      baseURL: 'https://api.datadoghq.com',
    })
    expect(request).toHaveBeenCalledWith({
      data: expect.anything(),
      headers: {
        'DD-API-KEY': 'DD_API_KEY_EXAMPLE',
        'DD-APPLICATION-KEY': 'DD_APP_KEY_EXAMPLE',
        'content-type': expect.stringContaining('multipart/form-data'),
      },
      method: 'POST',
      url: '/profiling/api/v1/depgraph',
    })
    const formData = (request.mock.calls[0] as any[])[0].data as FormData
    expect(formData).toBeDefined()

    // Read stream and normalize EOL
    const formPayload = (await streamToString(formData)).replace(/\r\n|\r|\n/g, '\n')

    const dependenciesContent = fs.readFileSync('./src/commands/dependencies/__tests__/fixtures/dependencies')
    expect(dependenciesContent).not.toBeFalsy()
    expect(formPayload).toContain(['Content-Disposition: form-data; name="service"', '', 'my-service'].join('\n'))
    expect(formPayload).toContain(['Content-Disposition: form-data; name="version"', '', '1.234'].join('\n'))
    expect(formPayload).toContain(['Content-Disposition: form-data; name="source"', '', 'snyk'].join('\n'))
    expect(formPayload).toContain(
      [
        'Content-Disposition: form-data; name="dependencies_file"; filename="dependencies"',
        'Content-Type: application/octet-stream',
        '',
        dependenciesContent,
      ].join('\n')
    )
  })

  test('handles API errors', async () => {
    const request = jest.fn(() => Promise.reject(new Error('No access granted')))
    ;(axios.create as jest.Mock).mockImplementation(() => request)

    const {context, code} = await runUploadDependeciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )

    const sdtout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual(['No access granted'])
    expect(sdtout[0]).toEqual(chalk.green('Starting upload.'))
    expect(sdtout[1]).toEqual(
      chalk.green('Will upload dependencies from src/commands/dependencies/__tests__/fixtures/dependencies file.')
    )
    expect(sdtout[2]).toEqual('version: 1.234 service: my-service')
    expect(sdtout[3]).toEqual('Uploading dependencies')
    expect(sdtout[4]).toEqual(expect.stringContaining('Failed upload dependencies: No access granted'))

    expect(code).toBe(3)
  })
})

interface RunUploadDependenciesInput {
  apiKey?: string
  appKey?: string
  dryRun?: boolean
  releaseVersion?: string
  service?: string
  source?: string
}

async function runUploadDependeciesCommand(path: string, input: RunUploadDependenciesInput) {
  const cli = new Cli()
  cli.register(UploadCommand)

  const context = createMockContext()

  process.env = {
    DATADOG_API_KEY: input.apiKey,
    DATADOG_APP_KEY: input.appKey,
  }
  const params = ['dependencies', 'upload', path]

  if (input.releaseVersion) {
    params.push('--release-version', input.releaseVersion)
  }
  if (input.service) {
    params.push('--service', input.service)
  }
  if (input.source) {
    params.push('--source', input.source)
  }
  if (input.dryRun) {
    params.push('--dry-run')
  }

  const code = await cli.run(params, context)

  return {context, code}
}

interface MockContext extends BaseContext {
  getStderrBuffer(): string
  getStdoutBuffer(): string
}

const createMockContext = (): MockContext => {
  const stdoutChunks: any[] = []
  const stderrChunks: any[] = []

  return {
    getStderrBuffer: () => stderrChunks.join(''),
    getStdoutBuffer: () => stdoutChunks.join(''),
    stderr: new Writable({
      write(chunk, encoding, callback) {
        stderrChunks.push(chunk)
        callback()
      },
    }),
    stdin: new Readable(),
    stdout: new Writable({
      write(chunk, encoding, callback) {
        stdoutChunks.push(chunk)
        callback()
      },
    }),
  }
}

function streamToString(stream: Readable): Promise<string> {
  const chunks: any[] = []

  return new Promise((resolve, reject) => {
    const handleData = (chunk: any) => chunks.push(chunk)
    const handleError = (error: any) => {
      stream.off('data', handleData)
      stream.off('end', handleEnd)

      reject(error)
    }
    const handleEnd = () => {
      stream.off('data', handleData)
      stream.off('error', handleError)

      resolve(chunks.join(''))
    }
    stream.on('data', handleData)
    stream.once('error', handleError)
    stream.once('end', handleEnd)

    stream.resume()
  })
}
