import {default as axios} from 'axios'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'

import FormData from 'form-data'
import {streamToString} from './helpers/stream'
import {runUploadCommand} from './helpers/upload.run'

describe('execute', () => {
  // Disable chalk colors before tests
  let previousLevel: number
  beforeAll(() => {
    previousLevel = chalk.level
    chalk.level = 0
  })

  // Restore chalk colors after tests
  afterAll(() => {
    chalk.level = previousLevel
  })

  test('runs with --dry-run parameter', async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const {context, code} = await runUploadCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toEqual('')

    expect(stdout).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD DEPENDENCIES.')
    expect(stdout).toMatch(new RegExp(`File:[\\s]+${resolvedFilePath}`))
    expect(stdout).toMatch(/Source:[\s]+snyk/)
    expect(stdout).toMatch(/Service:[\s]+my-service/)
    expect(stdout).toMatch(/Version:[\s]+1.234/)
    expect(stdout).toContain('[DRYRUN] Uploading dependencies...')
    expect(stdout).toMatch(/Dependencies uploaded in .* seconds\./)

    expect(code).toBe(0)
  })

  test('exits if missing api key', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain('Missing DATADOG_API_KEY in your environment.')
    expect(stdout).toEqual('')

    expect(code).toBe(1)
  })

  test('exits if missing app key', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain('Missing DATADOG_APP_KEY in your environment.')
    expect(stdout).toEqual('')

    expect(code).toBe(1)
  })

  test('exits if missing --service parameter', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain('Missing --service parameter.')
    expect(stdout).toEqual('')

    expect(code).toBe(1)
  })

  test('exits if missing --source parameter', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain('Missing --source parameter. Supported values are: snyk')
    expect(stdout).toEqual('')

    expect(code).toBe(1)
  })

  test('exits if invalid --source parameter', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'unknown-source',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain('Unsupported --source unknown-source. Supported values are: snyk')
    expect(stdout).toEqual('')

    expect(code).toBe(1)
  })

  test("exits if file doesn't exist", async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/unknown-dependencies'
    const resolvedFilePath = path.resolve(filePath)
    const {context, code} = await runUploadCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toContain(`Cannot find "${resolvedFilePath}" file.`)
    expect(stdout).toEqual('')

    expect(code).toBe(2)
  })

  test('shows warning if missing --release-version parameter', async () => {
    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      dryRun: true,
      service: 'my-service',
      source: 'snyk',
    })
    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toEqual('')
    expect(stdout).toContain('Missing optional --release-version parameter.')
    expect(stdout).toContain('The analysis may use out of date dependencies and produce false positives/negatives.')

    expect(code).toBe(0)
  })

  test('makes a valid API request', async () => {
    const filePath = './src/commands/dependencies/__tests__/fixtures/dependencies'
    const resolvedFilePath = path.resolve(filePath)

    const {context, code} = await runUploadCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })

    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toEqual('')
    expect(stdout).toMatch(new RegExp(`File:[\\s]+${resolvedFilePath}`))
    expect(stdout).toMatch(/Source:[\s]+snyk/)
    expect(stdout).toMatch(/Service:[\s]+my-service/)
    expect(stdout).toMatch(/Version:[\s]+1.234/)
    expect(stdout).toContain('Uploading dependencies...')
    expect(stdout).toMatch(/Dependencies uploaded in .* seconds\./)

    expect(code).toBe(0)

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.datadoghq.com/profiling/api/v1/dep-graphs',
      expect.anything(),
      {
        headers: {
          'DD-API-KEY': 'DD_API_KEY_EXAMPLE',
          'DD-APPLICATION-KEY': 'DD_APP_KEY_EXAMPLE',
          'content-type': expect.stringContaining('multipart/form-data'),
        },
      }
    )
    const formData = ((axios.post as jest.Mock).mock.calls[0] as any[])[1] as FormData
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
    ;(axios.post as jest.Mock).mockImplementation(() => Promise.reject(new Error('No access granted')))

    const {context, code} = await runUploadCommand(filePath, {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })

    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toEqual('No access granted')
    expect(stdout).toMatch(new RegExp(`File:[\\s]+${resolvedFilePath}`))
    expect(stdout).toMatch(/Source:[\s]+snyk/)
    expect(stdout).toMatch(/Service:[\s]+my-service/)
    expect(stdout).toMatch(/Version:[\s]+1.234/)
    expect(stdout).toContain('Uploading dependencies...')
    expect(stdout).toContain('Failed upload dependencies: No access granted')

    expect(code).toBe(3)
  })

  test('handles API 403 errors', async () => {
    ;(axios.post as jest.Mock).mockImplementation(() =>
      Promise.reject({message: 'Forbidden', isAxiosError: true, response: {status: 403}})
    )

    const {context, code} = await runUploadCommand('./src/commands/dependencies/__tests__/fixtures/dependencies', {
      apiKey: 'DD_API_KEY_EXAMPLE',
      appKey: 'DD_APP_KEY_EXAMPLE',
      releaseVersion: '1.234',
      service: 'my-service',
      source: 'snyk',
    })

    const stdout = context.stdout.toString()
    const stderr = context.stderr.toString()

    expect(stderr).toEqual('Forbidden')
    expect(stdout).toContain(
      'Failed upload dependencies: Forbidden. Check DATADOG_API_KEY and DATADOG_APP_KEY environment variables.'
    )

    expect(code).toBe(3)
  })
})
