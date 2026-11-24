import fs from 'fs'

import type {MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import {makeRunCLI, withTempDirectory} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as uploadHelper from '@datadog/datadog-ci-base/helpers/upload'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'

import * as helpers from '../../helpers'

import {PluginCommand} from '../upload'

const runCLI = makeRunCLI(PluginCommand, ['android-symbols', 'upload'])

describe('android-symbols upload', () => {
  const send = jest.fn()

  beforeEach(() => {
    send.mockResolvedValue(UploadStatus.Success)
    jest.spyOn(uploadHelper, 'upload').mockReturnValue(send)
    jest.spyOn(helpers, 'getAndroidSymbolsRequestBuilder').mockReturnValue(jest.fn())
  })

  afterEach(() => jest.restoreAllMocks())

  const withMapping = (fn: (path: string, idFile: string) => Promise<void>) =>
    withTempDirectory(async (directory) => {
      const path = `${directory}/mapping.txt`
      const idFile = `${directory}/datadog.buildId`
      fs.writeFileSync(path, 'com.example.App -> a:\n    void run() -> a\n')
      fs.writeFileSync(idFile, '93866010-ac2e-476a-a571-5f010b852d30\n')
      await fn(path, idFile)
    })

  const args = (path: string) => [path, '--service', 'my-app', '--version', '1.0.0+42', '--disable-git']

  test('uploads the exact build ID from the packaged asset, independently of Flutter', async () => {
    await withMapping(async (path, idFile) => {
      const {code, context} = await runCLI([...args(path), '--build-id-file', idFile])

      expect(code).toBe(0)
      const payload = send.mock.calls[0][0] as MultipartPayload
      const metadata = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      expect(metadata).toMatchObject({
        type: 'jvm_mapping_file',
        service: 'my-app',
        version: '1.0.0+42',
        variant: '',
        build_id: '93866010-ac2e-476a-a571-5f010b852d30',
      })
      expect(payload.content.get('jvm_mapping_file')).toMatchObject({type: 'file', path})
      expect(context.stdout.toString()).toContain('Uploaded Android mapping for build ID')
    })
  })

  test.each([
    [[], 'Provide exactly one'],
    [['--build-id', ''], 'must be non-empty'],
    [['--build-id', 'two ids'], 'contain no whitespace'],
    [['--build-id', 'a'.repeat(201)], 'at most 200'],
    [['--build-id-file', '/missing/datadog.buildId'], 'ENOENT'],
  ])('rejects invalid build identifiers without uploading: %j', async (options, expected) => {
    await withMapping(async (path) => {
      const {code, context} = await runCLI([...args(path), ...options])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain(expected)
      expect(send).not.toHaveBeenCalled()
    })
  })

  test('rejects an empty ID file and conflicting identifiers', async () => {
    await withMapping(async (path, idFile) => {
      fs.writeFileSync(idFile, '\n')
      expect((await runCLI([...args(path), '--build-id-file', idFile])).code).toBe(1)
      expect((await runCLI([...args(path), '--build-id-file', idFile, '--build-id', 'other'])).code).toBe(1)
      expect(send).not.toHaveBeenCalled()
    })
  })

  test('rejects a missing or empty mapping', async () => {
    await withMapping(async (path) => {
      fs.writeFileSync(path, '')
      expect((await runCLI([...args(path), '--build-id', 'app-id'])).code).toBe(1)
      expect((await runCLI([...args(`${path}.missing`), '--build-id', 'app-id'])).code).toBe(1)
      expect(send).not.toHaveBeenCalled()
    })
  })

  test('returns failure when the shared uploader fails after retries', async () => {
    await withMapping(async (path) => {
      send.mockResolvedValue(UploadStatus.Failure)
      const {code, context} = await runCLI([...args(path), '--build-id', 'app-id'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).not.toContain('Uploaded Android mapping')
    })
  })

  test('dry run validates the build ID without sending an upload', async () => {
    await withMapping(async (path, idFile) => {
      const {code, context} = await runCLI([...args(path), '--build-id-file', idFile, '--dry-run'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('[DRYRUN]')
      expect(send).not.toHaveBeenCalled()
    })
  })

  test('uses the configured Datadog site', async () => {
    await withMapping(async (path) => {
      const {code} = await runCLI([...args(path), '--build-id', 'app-id'], {DATADOG_SITE: 'datadoghq.eu'})

      expect(code).toBe(0)
      expect(helpers.getAndroidSymbolsRequestBuilder).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'datadoghq.eu'
      )
    })
  })
})
