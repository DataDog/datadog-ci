import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {WasmSourcemapsUploadCommand} from '../upload'

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(() => Promise.resolve(UploadStatus.Success)),
}))

describe('wasm-sourcemaps upload', () => {
  let fixtureDir: string

  beforeEach(() => {
    fixtureDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'wasm-sourcemaps-upload-tests-'))
    jest.clearAllMocks()
  })

  afterEach(() => fs.rmSync(fixtureDir, {recursive: true}))

  const writeSourcemap = (relativeModulePath: string) => {
    const modulePath = upath.join(fixtureDir, relativeModulePath)
    const sourcemapPath = `${modulePath}.map`
    fs.mkdirSync(upath.dirname(modulePath), {recursive: true})
    fs.writeFileSync(sourcemapPath, JSON.stringify({version: 3, sources: ['main.dart'], mappings: ''}))

    return {modulePath, sourcemapPath}
  }

  const runCommand = async (prepare: (command: WasmSourcemapsUploadCommand) => void) => {
    const command = createCommand(WasmSourcemapsUploadCommand)
    command['basePath'] = fixtureDir
    command['service'] = 'checkout-web'
    command['releaseVersion'] = '1.2.3'
    command['minifiedPathPrefix'] = 'https://cdn.example.com/flutter/'
    command['disableGit'] = true
    prepare(command)

    return {command, exitCode: await command.execute()}
  }

  test('requires service, release version, and minified path prefix', async () => {
    const command = createCommand(WasmSourcemapsUploadCommand)
    command['basePath'] = fixtureDir
    command['disableGit'] = true

    const exitCode = await command.execute()

    expect(exitCode).toBe(1)
    expect(command.context.stderr.toString()).toContain('Missing --service')
    expect(command.context.stderr.toString()).toContain('Missing --release-version')
    expect(command.context.stderr.toString()).toContain('Missing --minified-path-prefix')
  })

  test('discovers source maps recursively and constructs module URLs', async () => {
    const pair = writeSourcemap('nested/main.dart.wasm')
    const {command} = await runCommand((cmd) => {
      cmd['dryRun'] = true
    })

    await expect(command['getWasmSourcemapFiles']()).resolves.toEqual([
      {
        moduleUrl: 'https://cdn.example.com/flutter/nested/main.dart.wasm',
        sourcemapPath: pair.sourcemapPath,
      },
    ])
  })

  test.each([false, true])('uploads without a local WASM module (single file: %s)', async (singleFile) => {
    const {modulePath, sourcemapPath} = writeSourcemap('main.dart.wasm')

    const {exitCode} = await runCommand((cmd) => {
      if (singleFile) {
        cmd['basePath'] = sourcemapPath
      }
    })

    expect(fs.existsSync(modulePath)).toBe(false)
    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
    const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
    expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value).minified_url).toBe(
      'https://cdn.example.com/flutter/main.dart.wasm'
    )
    expect((payload.content.get('source_map') as MultipartFileValue).path).toBe(sourcemapPath)
    expect([...payload.content.keys()]).toEqual(['event', 'source_map'])
  })

  test('uploads metadata keyed by service, version, and module URL', async () => {
    const pair = writeSourcemap('main.dart.wasm')

    const {exitCode} = await runCommand(() => {})

    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
    const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
    expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value)).toEqual({
      cli_version: cliVersion,
      minified_url: 'https://cdn.example.com/flutter/main.dart.wasm',
      service: 'checkout-web',
      type: 'wasm_sourcemap',
      version: '1.2.3',
    })
    const sourceMap = payload.content.get('source_map') as MultipartFileValue
    expect(sourceMap.path).toBe(pair.sourcemapPath)
    expect(sourceMap.options.filename).toBe('source_map')
    expect(payload.content.has('minified_file')).toBe(false)
  })

  test.each([
    ['https://cdn.example.com/app/', 'https://cdn.example.com/app/nested/main.dart.wasm'],
    ['https://cdn.example.com/app', 'https://cdn.example.com/app/nested/main.dart.wasm'],
    ['/app/', '/app/nested/main.dart.wasm'],
    // Like JS, a root-only prefix omits the leading slash in the upload metadata.
    ['/', 'nested/main.dart.wasm'],
  ])('uploads module paths relative to the build directory with prefix %s', async (prefix, expectedUrl) => {
    writeSourcemap('nested/main.dart.wasm')

    const {exitCode} = await runCommand((cmd) => {
      cmd['minifiedPathPrefix'] = prefix
    })

    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
    const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
    expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value).minified_url).toBe(expectedUrl)
  })

  test('uses the module filename when uploading a single source map', async () => {
    const pair = writeSourcemap('nested/main.dart.wasm')

    const {exitCode} = await runCommand((cmd) => {
      cmd['basePath'] = pair.sourcemapPath
    })

    expect(exitCode).toBe(0)
    const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
    expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value).minified_url).toBe(
      'https://cdn.example.com/flutter/main.dart.wasm'
    )
  })

  test('does not upload during a dry run', async () => {
    writeSourcemap('main.dart.wasm')

    const {exitCode} = await runCommand((cmd) => {
      cmd['dryRun'] = true
    })

    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })
})
