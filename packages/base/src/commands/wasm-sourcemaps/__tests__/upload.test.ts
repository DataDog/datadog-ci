import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {renderMissingModule} from '../renderer'
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

  const writePair = (relativeModulePath: string) => {
    const modulePath = upath.join(fixtureDir, relativeModulePath)
    const sourcemapPath = `${modulePath}.map`
    fs.mkdirSync(upath.dirname(modulePath), {recursive: true})
    fs.writeFileSync(modulePath, Buffer.from([0x00, 0x61, 0x73, 0x6d]))
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

  test('requires a .wasm.map filename when uploading a single file', async () => {
    const invalidPath = upath.join(fixtureDir, 'main.map')
    fs.writeFileSync(invalidPath, '{}')
    const command = createCommand(WasmSourcemapsUploadCommand)
    command['basePath'] = invalidPath
    command['service'] = 'checkout-web'
    command['releaseVersion'] = '1.2.3'
    command['minifiedPathPrefix'] = 'https://cdn.example.com/flutter/'
    command['disableGit'] = true

    const exitCode = await command.execute()

    expect(exitCode).toBe(1)
    expect(command.context.stderr.toString()).toContain(`${invalidPath} must have a .wasm.map extension.`)
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })

  test('discovers source maps recursively and constructs module URLs', async () => {
    const pair = writePair('nested/main.dart.wasm')
    const {command} = await runCommand((cmd) => {
      cmd['dryRun'] = true
    })

    await expect(command['getWasmSourcemapFiles']()).resolves.toEqual([
      {
        modulePath: pair.modulePath,
        moduleUrl: 'https://cdn.example.com/flutter/nested/main.dart.wasm',
        sourcemapPath: pair.sourcemapPath,
      },
    ])
  })

  test('skips a source map when its module is missing', async () => {
    const sourcemapPath = upath.join(fixtureDir, 'missing.wasm.map')
    fs.writeFileSync(sourcemapPath, '{}')

    const {command, exitCode} = await runCommand((cmd) => {
      cmd['dryRun'] = true
    })

    expect(exitCode).toBe(0)
    expect(command.context.stdout.toString()).toContain(renderMissingModule(upath.join(fixtureDir, 'missing.wasm')))
  })

  test('uploads metadata keyed by service, version, and module URL', async () => {
    const pair = writePair('main.dart.wasm')

    const {exitCode} = await runCommand(() => {})

    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
    const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
    expect(JSON.parse((payload.content.get('event') as MultipartStringValue).value)).toEqual({
      cli_version: cliVersion,
      minified_url: 'https://cdn.example.com/flutter/main.dart.wasm',
      service: 'checkout-web',
      type: 'flutter_wasm_sourcemap',
      version: '1.2.3',
    })
    const sourceMap = payload.content.get('source_map') as MultipartFileValue
    expect(sourceMap.path).toBe(pair.sourcemapPath)
    expect(sourceMap.options.filename).toBe('source_map')
    expect(payload.content.has('minified_file')).toBe(false)
  })

  test('does not upload during a dry run', async () => {
    writePair('main.dart.wasm')

    const {exitCode} = await runCommand((cmd) => {
      cmd['dryRun'] = true
    })

    expect(exitCode).toBe(0)
    expect(uploadMultipartHelper).not.toHaveBeenCalled()
  })
})
