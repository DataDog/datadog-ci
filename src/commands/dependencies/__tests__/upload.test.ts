import {default as axios} from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {BaseContext, Cli} from 'clipanion/lib/advanced'
import FormData from 'form-data'
import {Readable, Writable} from 'stream'
import {UploadCommand} from '../upload'

describe('execute', () => {
  test('runs with --dry-run parameter', async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const {context, code} = await runUploadDependenciesCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([''])
    expect(stdout[0]).toEqual(chalk.yellow('DRY-RUN MODE ENABLED. WILL NOT UPLOAD DEPENDENCIES.'))
    expect(stdout[1]).toEqual(`${chalk.bold('File')}:    ${resolvedFilePath}`)
    expect(stdout[2]).toEqual(`${chalk.bold('Source')}:  snyk`)
    expect(stdout[3]).toEqual(`${chalk.bold('Service')}: my-service`)
    expect(stdout[4]).toEqual(`${chalk.bold('Version')}: 1.234`)
    expect(stdout[5]).toEqual('')
    expect(stdout[6]).toEqual('[DRYRUN] Uploading dependencies...')
    expect(stdout[7]).toMatch(/Dependencies uploaded in .* seconds\./)

    expect(code).toBe(0)
  })

  test('exits if missing api key', async () => {
    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(chalk.red(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`))
    expect(stdout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing app key', async () => {
    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(chalk.red(`Missing ${chalk.bold('DATADOG_APP_KEY')} in your environment.`))
    expect(stdout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing --service parameter', async () => {
    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        source: 'snyk',
      }
    )
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(chalk.red(`Missing ${chalk.bold('--service')} parameter.`))
    expect(stdout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if missing --source parameter', async () => {
    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        releaseVersion: '1.234',
        service: 'my-service',
      }
    )
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(
      chalk.red(`Missing ${chalk.bold('--source')} parameter. Supported values are: ${chalk.bold('snyk')}`)
    )
    expect(stdout).toEqual([''])

    expect(code).toBe(1)
  })

  test('exits if invalid --source parameter', async () => {
    const {context, code} = await runUploadDependenciesCommand(
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
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(
      chalk.red(`Unsupported ${chalk.bold('--source')} unknown-source. Supported values are: ${chalk.bold('snyk')}`)
    )
    expect(stdout).toEqual([''])

    expect(code).toBe(1)
  })

  test("exits if file doesn't exist", async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/unknown-dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const {context, code} = await runUploadDependenciesCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr[0]).toEqual(chalk.red(`Cannot find "${resolvedFilePath}" file.`))
    expect(stdout).toEqual([''])

    expect(code).toBe(2)
  })

  test('shows warning if missing --release-version parameter', async () => {
    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        dryRun: true,
        service: 'my-service',
        source: 'snyk',
      }
    )
    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([''])
    const releaseVersion = chalk.bold('--release-version')
    expect(stdout[0]).toEqual(
      chalk.yellow('┌──────────────────────────────────────────────────────────────────────────────────────┐')
    )
    expect(stdout[1]).toEqual(
      chalk.yellow(`│ Missing optional ${releaseVersion} parameter.                                        │`)
    )
    expect(stdout[2]).toEqual(
      chalk.yellow('│ The analysis may use out of date dependencies and produce false positives/negatives. │')
    )
    expect(stdout[3]).toEqual(
      chalk.yellow('└──────────────────────────────────────────────────────────────────────────────────────┘')
    )

    expect(code).toBe(0)
  })

  test('makes a valid API request', async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const request = jest.fn(() => Promise.resolve())
    ;(axios.create as jest.Mock).mockImplementation(() => request)

    const {context, code} = await runUploadDependenciesCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })

    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual([''])
    expect(stdout[0]).toEqual(`${chalk.bold('File')}:    ${resolvedFilePath}`)
    expect(stdout[1]).toEqual(`${chalk.bold('Source')}:  snyk`)
    expect(stdout[2]).toEqual(`${chalk.bold('Service')}: my-service`)
    expect(stdout[3]).toEqual(`${chalk.bold('Version')}: 1.234`)
    expect(stdout[4]).toEqual('')
    expect(stdout[5]).toEqual('Uploading dependencies...')
    expect(stdout[6]).toMatch(/Dependencies uploaded in .* seconds\./)

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
      url: '/profiling/api/v1/dep-graphs',
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
        'Content-Disposition: form-data; name="file"; filename="dependencies"',
        'Content-Type: application/octet-stream',
        '',
        dependenciesContent,
      ].join('\n')
    )
  })

  test('handles API errors', async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const request = jest.fn(() => Promise.reject(new Error('No access granted')))
    ;(axios.create as jest.Mock).mockImplementation(() => request)

    const {context, code} = await runUploadDependenciesCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })

    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual(['No access granted'])
    expect(stdout[0]).toEqual(`${chalk.bold('File')}:    ${resolvedFilePath}`)
    expect(stdout[1]).toEqual(`${chalk.bold('Source')}:  snyk`)
    expect(stdout[2]).toEqual(`${chalk.bold('Service')}: my-service`)
    expect(stdout[3]).toEqual(`${chalk.bold('Version')}: 1.234`)
    expect(stdout[4]).toEqual('')
    expect(stdout[5]).toEqual('Uploading dependencies...')
    expect(stdout[6]).toEqual(chalk.red('Failed upload dependencies: No access granted'))

    expect(code).toBe(3)
  })

  test('handles API 403 errors', async () => {
    const request = jest.fn(() => Promise.reject({message: 'Forbidden', isAxiosError: true, response: {status: 403}}))
    ;(axios.create as jest.Mock).mockImplementation(() => request)

    const {context, code} = await runUploadDependenciesCommand(
      './src/commands/dependencies/__tests__/fixtures/dependencies',
      {
        apiKey: 'DD_API_KEY_EXAMPLE',
        appKey: 'DD_APP_KEY_EXAMPLE',
        releaseVersion: '1.234',
        service: 'my-service',
        source: 'snyk',
      }
    )

    const stdout = context.getStdoutBuffer().split(os.EOL)
    const stderr = context.getStderrBuffer().split(os.EOL)

    expect(stderr).toEqual(['Forbidden'])
    expect(stdout[6]).toEqual(
      chalk.red(
        `Failed upload dependencies: Forbidden. Check ${chalk.bold('DATADOG_API_KEY')} and ${chalk.bold(
          'DATADOG_APP_KEY'
        )} environment variables.`
      )
    )

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

async function runUploadDependenciesCommand(filePath: string, input: RunUploadDependenciesInput) {
  const cli = new Cli()
  cli.register(UploadCommand)

  const context = createMockContext()

  process.env = {
    DATADOG_API_KEY: input.apiKey,
    DATADOG_APP_KEY: input.appKey,
  }
  const params = ['dependencies', 'upload', filePath]

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
