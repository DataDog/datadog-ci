import fs from 'fs'
import os from 'os'

import type {MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {getRepositoryData, TrackedFilesMatcher} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'

import {FlutterSymbolsUploadCommand} from '../upload'

const mockUpload = jest.fn<Promise<UploadStatus>, [MultipartPayload]>()

jest.mock('@datadog/datadog-ci-base/helpers/upload', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/upload'),
  upload: jest.fn(() => mockUpload),
}))

jest.mock('@datadog/datadog-ci-base/helpers/metrics', () => ({
  getMetricsLogger: jest.fn(async () => ({
    flush: jest.fn(),
    logger: {increment: jest.fn(), gauge: jest.fn()},
  })),
}))

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
  newSimpleGit: jest.fn(async () => ({})),
}))

jest.mock('@datadog/datadog-ci-base/commands/git-metadata/git', () => ({
  newSimpleGit: jest.fn(async () => ({})),
}))

const getMetadata = (payload: MultipartPayload) =>
  JSON.parse((payload.content.get('event') as MultipartStringValue).value)

describe('Flutter web sourcemap subcommands', () => {
  const runCLI = makeRunCLI(FlutterSymbolsUploadCommand, [
    'flutter-symbols',
    'upload',
    '--service-name',
    'flutter-web',
    '--minified-path-prefix',
    'https://cdn.example.com/app/',
  ])
  let originalCwd: string
  let fixtureDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    fixtureDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'flutter-web-sourcemaps-tests-'))
    process.chdir(fixtureDir)
    fs.writeFileSync('pubspec.yaml', 'name: flutter_app\nversion: 1.2.3+42\n')
    fs.mkdirSync('build/web/nested', {recursive: true})
    fs.writeFileSync('build/web/main.dart.js', 'console.log("hello");\n//# sourceMappingURL=main.dart.js.map\n')
    const sourceMap = JSON.stringify({
      version: 3,
      sources: ['main.dart'],
      sourcesContent: ['void main() {}'],
      mappings: '',
    })
    fs.writeFileSync('build/web/main.dart.js.map', sourceMap)
    fs.writeFileSync('build/web/nested/main.dart.wasm.map', sourceMap)
    mockUpload.mockReset().mockResolvedValue(UploadStatus.Success)
    jest.mocked(getRepositoryData).mockReset()
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(fixtureDir, {recursive: true, force: true})
  })

  test('uploads both targets with the pubspec version without beta opt-in or a local WASM module', async () => {
    const {code} = await runCLI(['--web-sourcemaps', '--disable-git'])

    expect(code).toBe(0)
    expect(process.env.DD_BETA_COMMANDS_ENABLED).toBeUndefined()
    expect(fs.existsSync('build/web/nested/main.dart.wasm')).toBe(false)
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls.map(([payload]) => getMetadata(payload))).toEqual([
      expect.objectContaining({
        type: 'js_sourcemap',
        service: 'flutter-web',
        version: '1.2.3',
        minified_url: 'https://cdn.example.com/app/main.dart.js',
      }),
      expect.objectContaining({
        type: 'wasm_sourcemap',
        service: 'flutter-web',
        version: '1.2.3',
        minified_url: 'https://cdn.example.com/app/nested/main.dart.wasm',
      }),
    ])
    expect(getRepositoryData).not.toHaveBeenCalled()
    expect(mockUpload.mock.calls.every(([payload]) => !payload.content.has('repository'))).toBe(true)
  })

  test('supports a custom location and explicit version for both targets', async () => {
    fs.renameSync('build/web', 'custom-web')

    const {code} = await runCLI(['--web-sourcemaps-location', './custom-web', '--version', '2.0.0+7', '--disable-git'])

    expect(code).toBe(0)
    expect(mockUpload).toHaveBeenCalledTimes(2)
    for (const [payload] of mockUpload.mock.calls) {
      expect(getMetadata(payload).version).toBe('2.0.0+7')
      expect(payload.content.get('source_map')).toEqual(
        expect.objectContaining({path: expect.stringContaining('custom-web/')})
      )
    }
  })

  test('skips the WASM subcommand for a JS-only build', async () => {
    fs.rmSync('build/web/nested/main.dart.wasm.map')

    const {code, context} = await runCLI(['--web-sourcemaps', '--disable-git'])

    expect(code).toBe(0)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(getMetadata(mockUpload.mock.calls[0][0]).type).toBe('js_sourcemap')
    expect(context.stdout.toString()).not.toContain('Uploading WASM sourcemaps from:')
  })

  test('does not upload web maps unless web uploads are requested', async () => {
    const {code} = await runCLI(['--disable-git'])

    expect(code).toBe(0)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  test('dry-runs both subcommands without uploading', async () => {
    const {code, context} = await runCLI(['--web-sourcemaps', '--dry-run', '--disable-git'])

    expect(code).toBe(0)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(context.stdout.toString()).toContain('[DRYRUN] Uploading sourcemap')
    expect(context.stdout.toString()).toContain('[DRYRUN] Uploading WASM sourcemap')
  })

  test('collects Git metadata once and attaches it to both targets', async () => {
    const repositoryData = {
      hash: 'fake-git-hash',
      remote: 'https://github.com/example/app',
      trackedFilesMatcher: new TrackedFilesMatcher(['lib/main.dart']),
    }
    jest.mocked(getRepositoryData).mockResolvedValueOnce(repositoryData)

    const {code} = await runCLI(['--web-sourcemaps', '--repository-url', 'https://github.com/example/app'])

    expect(code).toBe(0)
    expect(getRepositoryData).toHaveBeenCalledTimes(1)
    expect(getRepositoryData).toHaveBeenCalledWith(expect.anything(), 'https://github.com/example/app')
    expect(mockUpload).toHaveBeenCalledTimes(2)
    for (const [payload] of mockUpload.mock.calls) {
      const repository = JSON.parse((payload.content.get('repository') as MultipartStringValue).value)
      expect(repository.data[0]).toEqual(
        expect.objectContaining({hash: repositoryData.hash, repository_url: repositoryData.remote})
      )
    }
  })

  test('does not retry Git discovery after it fails in the parent command', async () => {
    jest.mocked(getRepositoryData).mockRejectedValueOnce(new Error('not a repository'))

    const {code} = await runCLI(['--web-sourcemaps'])

    expect(code).toBe(0)
    expect(getRepositoryData).toHaveBeenCalledTimes(1)
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls.every(([payload]) => !payload.content.has('repository'))).toBe(true)
  })

  test('returns a failure if the WASM upload fails', async () => {
    mockUpload.mockImplementation(async (payload) =>
      getMetadata(payload).type === 'wasm_sourcemap' ? UploadStatus.Failure : UploadStatus.Success
    )

    const {code, context} = await runCLI(['--web-sourcemaps', '--disable-git'])

    expect(code).toBe(1)
    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(context.stdout.toString()).toContain('Some symbol files may not been uploaded correctly.')
  })
})
