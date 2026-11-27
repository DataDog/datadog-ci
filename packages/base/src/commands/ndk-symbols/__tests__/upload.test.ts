import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {
  expectRepositoryPartBuiltOnce,
  makeFakeRepositoryData,
} from '@datadog/datadog-ci-base/helpers/git/__tests__/repository-payload-testing-tools'
import {TrackedFilesMatcher, getRepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {renderArgumentMissingError, renderInvalidBuildId, renderInvalidSymbolsLocation} from '../renderer'
import {NdkSymbolsUploadCommand} from '../upload'

const fixtureDir = 'src/commands/ndk-symbols/__tests__/fixtures'
const libsDir = `${fixtureDir}/libs`
const buildId = '01234567-89ab-cdef-0123-456789abcdef'

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(),
}))

const uploadedPayloads = (): MultipartPayload[] =>
  (uploadMultipartHelper as jest.Mock).mock.calls.map((call) => call[1] as MultipartPayload)

const uploadedEvent = (payload: MultipartPayload) =>
  JSON.parse((payload.content.get('event') as MultipartStringValue).value)

const uploadedFile = (payload: MultipartPayload) => payload.content.get('ndk_symbol_file') as MultipartFileValue

const uploadedPaths = () => uploadedPayloads().map((payload) => uploadedFile(payload).path)

describe('ndk-symbols upload', () => {
  const runCommand = async (prepFunction: (command: NdkSymbolsUploadCommand) => void) => {
    const command = createCommand(NdkSymbolsUploadCommand)
    command['buildId'] = buildId
    command['disableGit'] = true
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context: command.context, output: command.context.stdout.toString()}
  }

  beforeEach(() => {
    ;(getRepositoryData as jest.Mock).mockReset()
    ;(uploadMultipartHelper as jest.Mock).mockReset()
    ;(uploadMultipartHelper as jest.Mock).mockResolvedValue(UploadStatus.Success)
  })

  describe('parameter validation', () => {
    const runCLI = makeRunCLI(NdkSymbolsUploadCommand, ['ndk-symbols', 'upload'])

    test('requires a build ID', async () => {
      const {code, context} = await runCLI([libsDir, '--dry-run'])

      expect(code).not.toBe(0)
      expect(context.stderr.toString()).toContain(renderArgumentMissingError('build-id'))
    })

    test.each(['not-a-uuid', '0123456789abcdef0123456789abcdef', `${buildId}0`, `{${buildId}}`])(
      'rejects the build ID %s',
      async (invalidBuildId) => {
        const {code, context} = await runCLI([libsDir, '--build-id', invalidBuildId, '--dry-run'])

        expect(code).not.toBe(0)
        expect(context.stderr.toString()).toContain(renderInvalidBuildId(invalidBuildId))
        expect(uploadMultipartHelper).not.toHaveBeenCalled()
      }
    )

    test('accepts an upper-case build ID and sends it in lower case', async () => {
      const {code} = await runCLI([libsDir, '--build-id', buildId.toUpperCase(), '--disable-git'])

      expect(code).toBe(0)
      expect(uploadedPayloads().map((payload) => uploadedEvent(payload).build_id)).toEqual(Array(4).fill(buildId))
    })

    test('accepts a build ID with a trailing newline, as read from a file', async () => {
      const {code} = await runCLI([`${libsDir}/x86`, '--build-id', `${buildId}\r\n`, '--disable-git'])

      expect(code).toBe(0)
      expect(uploadedEvent(uploadedPayloads()[0]).build_id).toBe(buildId)
    })

    test.each(['0', '-5', 'abc'])('rejects a max concurrency of %s', async (maxConcurrency) => {
      const {code} = await runCLI([libsDir, '--build-id', buildId, '--max-concurrency', maxConcurrency, '--dry-run'])

      expect(code).not.toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })

    test('runs a dry run without an API key', async () => {
      const {code, context} = await runCLI([libsDir, '--build-id', buildId, '--dry-run', '--disable-git'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('[DRYRUN] Handled symbol 4 files with success')
    })

    test('fails if no symbols location is given', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = []
      })

      expect(exitCode).not.toBe(0)
      expect(context.stderr.toString()).toContain(renderArgumentMissingError('symbols locations'))
    })

    test('fails if a symbols location does not exist', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/does-not-exist`]
      })

      expect(exitCode).not.toBe(0)
      expect(context.stderr.toString()).toContain(renderInvalidSymbolsLocation(`${fixtureDir}/does-not-exist`))
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })
  })

  describe('upload', () => {
    test('uploads every library with its architecture and file name', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [libsDir]
      })

      expect(exitCode).toBe(0)
      const uploads = uploadedPayloads()
        .map((payload) => ({
          arch: uploadedEvent(payload).arch,
          filename: uploadedFile(payload).options.filename,
          path: uploadedFile(payload).path,
        }))
        .sort((a, b) => a.arch.localeCompare(b.arch))
      expect(uploads).toEqual([
        {arch: 'arm', filename: 'libnative.so', path: `${libsDir}/armeabi-v7a/libnative.so`},
        {arch: 'arm64', filename: 'libnative.so', path: `${libsDir}/arm64-v8a/libnative.so`},
        {arch: 'x64', filename: 'libnative.so', path: `${libsDir}/x86_64/libnative.so`},
        {arch: 'x86', filename: 'libnative.so', path: `${libsDir}/x86/libnative.so`},
      ])
      expect(output).toContain('Native libraries: 4 uploaded, 0 skipped, 0 failed.')
      expect(output).toContain('Uploaded symbol 4 files in')
    })

    test('uploads the files as they are, gzipped in transit with retries', async () => {
      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/x86/libnative.so`]
      })

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      const [, payload, options] = (uploadMultipartHelper as jest.Mock).mock.calls[0]
      expect(uploadedFile(payload).path).toBe(`${libsDir}/x86/libnative.so`)
      expect(options).toMatchObject({retries: 5, useGzip: true})
    })

    test('creates the event metadata', async () => {
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher(['./native.c']),
      })

      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/arm64-v8a/libnative.so`]
        cmd['disableGit'] = false
        cmd['serviceName'] = 'com.example.app'
        cmd['version'] = '1.2.3'
        cmd['variant'] = 'prod'
      })

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      expect(uploadedEvent(uploadedPayloads()[0])).toEqual({
        arch: 'arm64',
        build_id: buildId,
        cli_version: cliVersion,
        type: 'ndk_symbol_file',
        service: 'com.example.app',
        version: '1.2.3',
        variant: 'prod',
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
      })
    })

    test('leaves out service, version and variant when not given', async () => {
      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/arm64-v8a/libnative.so`]
      })

      expect(uploadedEvent(uploadedPayloads()[0])).toEqual({
        arch: 'arm64',
        build_id: buildId,
        cli_version: cliVersion,
        type: 'ndk_symbol_file',
      })
    })

    test('builds the repository part once and attaches it to every upload', async () => {
      const repositoryData = makeFakeRepositoryData()
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce(repositoryData)
      const spy = jest.spyOn(repositoryData.trackedFilesMatcher, 'rawTrackedFilesList')

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [libsDir]
        cmd['disableGit'] = false
      })

      expect(exitCode).toBe(0)
      expectRepositoryPartBuiltOnce(uploadedPayloads(), spy)
    })

    test('skips libraries without symbols', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/arm64-v8a`, `${fixtureDir}/stripped`]
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      expect(output).toContain('libstripped.so: it has no symbols')
      expect(output).toContain('Native libraries: 1 uploaded, 1 skipped, 0 failed.')
      expect(output).toContain('Some symbol files have been skipped.')
      expect(output).not.toContain('nothing was uploaded')
    })

    test('warns when no library found has symbols', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/stripped`]
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain('None of the 1 native library found has symbols, nothing was uploaded.')
      expect(output).toContain('Native libraries: 0 uploaded, 1 skipped, 0 failed.')
    })

    test('uploads libraries that only have debug info', async () => {
      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/debug-only`]
      })

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      expect(uploadedFile(uploadedPayloads()[0]).options.filename).toBe('libdebugonly.so')
    })

    test('skips debug-only copies, which have no code', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/no-code`]
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain("libnocode.so: it's a debug-only copy")
      expect(output).toContain('Some symbol files have been skipped.')
    })

    test('skips libraries whose name Android would not load', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/odd-name`]
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain('App1.dll.so: Android only loads native libraries named lib*.so')
      expect(output).toContain('Some symbol files have been skipped.')
    })

    test('skips files that are not native libraries', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/not-elf`, `${fixtureDir}/big-endian`]
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain('libfake.so: not an ELF file.')
      expect(output).toContain('libbigendian.so: big-endian')
      expect(output).toContain('Some symbol files have been skipped.')
    })

    test('uploads a library found twice only once', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/arm64-v8a`, `${fixtureDir}/overlap`, `${libsDir}/arm64-v8a/libnative.so`]
      })

      expect(uploadedPaths()).toEqual([`${libsDir}/arm64-v8a/libnative.so`])
      expect(output).toContain('same file as')
      expect(output).toContain('Uploaded symbol 1 file in')
    })

    test('uploads neither of two different libraries with the same name and architecture', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${libsDir}/arm64-v8a`, `${fixtureDir}/conflict`, `${libsDir}/x86`]
      })

      expect(exitCode).toBe(0)
      expect(uploadedPaths()).toEqual([`${libsDir}/x86/libnative.so`])
      expect(output).toContain(
        'Not uploading arm64 libnative.so: files with this name and architecture have different content'
      )
      expect(output).toContain(`  - ${libsDir}/arm64-v8a/libnative.so`)
      expect(output).toContain(`  - ${fixtureDir}/conflict/arm64-v8a/libnative.so`)
      expect(output).toContain('Native libraries: 1 uploaded, 0 skipped, 2 failed.')
      expect(output).toContain('Some symbol files may not been uploaded correctly.')
    })

    test('reports failed uploads', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue(UploadStatus.Failure)

      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [libsDir]
      })

      expect(exitCode).toBe(0)
      expect(output).toContain('Native libraries: 0 uploaded, 0 skipped, 4 failed.')
      expect(output).toContain('Some symbol files may not been uploaded correctly.')
    })

    test('reports that nothing was found', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/no-libraries`]
      })

      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain('No actions were taken.')
    })

    test('does not upload on dry run', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [libsDir]
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain('[DRYRUN] Native libraries: 4 to upload, 0 skipped, 0 failed.')
      expect(output).toContain('[DRYRUN] Handled symbol 4 files with success')
    })

    describe('with folders made for the test', () => {
      let tmpDir: string

      beforeEach(() => {
        tmpDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'ndk-symbols-'))
      })

      afterEach(() => {
        fs.chmodSync(tmpDir, 0o755)
        fs.rmSync(tmpDir, {recursive: true, force: true})
      })

      const copyLibrary = (abi: string, destination: string) => {
        fs.mkdirSync(upath.dirname(destination), {recursive: true})
        fs.copyFileSync(`${libsDir}/${abi}/libnative.so`, destination)
      }

      test('takes folder names literally, even with glob characters', async () => {
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'v[12]', 'libmine.so'))
        copyLibrary('x86_64', upath.join(tmpDir, 'v1', 'libsibling.so'))

        await runCommand((cmd) => {
          cmd['symbolsLocations'] = [upath.join(tmpDir, 'v[12]')]
        })

        expect(uploadedPaths()).toEqual([upath.join(tmpDir, 'v[12]', 'libmine.so')])
      })

      test('follows symbolic links to folders', async () => {
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'target', 'arm64-v8a', 'libnative.so'))
        fs.mkdirSync(upath.join(tmpDir, 'scan'))
        fs.symlinkSync(upath.join(tmpDir, 'target'), upath.join(tmpDir, 'scan', 'link'))

        await runCommand((cmd) => {
          cmd['symbolsLocations'] = [upath.join(tmpDir, 'scan')]
        })

        expect(uploadedPaths()).toEqual([upath.join(tmpDir, 'scan', 'link', 'arm64-v8a', 'libnative.so')])
      })

      test('uploads a symbolic link under its own name, even next to its target', async () => {
        const target = upath.join(tmpDir, 'arm64-v8a', 'App1.dll.so')
        copyLibrary('arm64-v8a', target)
        fs.symlinkSync('App1.dll.so', upath.join(tmpDir, 'arm64-v8a', 'libaot-App1.dll.so'))

        const {output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })

        expect(uploadedPayloads().map((payload) => uploadedFile(payload).options.filename)).toEqual([
          'libaot-App1.dll.so',
        ])
        expect(output).toContain('App1.dll.so: Android only loads native libraries named lib*.so')
        expect(output).toContain('Native libraries: 1 uploaded, 1 skipped, 0 failed.')
      })

      test('does not report all libraries as stripped when others were skipped for another reason', async () => {
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'arm64-v8a', 'App1.dll.so'))
        fs.copyFileSync(
          `${fixtureDir}/stripped/arm64-v8a/libstripped.so`,
          upath.join(tmpDir, 'arm64-v8a', 'libstripped.so')
        )

        const {output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })

        expect(output).not.toContain('None of the')
      })

      test('reports a library that cannot be read as failed', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
          return // file permissions don't apply
        }
        const path = upath.join(tmpDir, 'arm64-v8a', 'libnative.so')
        copyLibrary('arm64-v8a', path)
        fs.chmodSync(path, 0o000)

        const {output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })

        expect(uploadMultipartHelper).not.toHaveBeenCalled()
        expect(output).toContain(`Could not read ${path}`)
        expect(output).toContain('Native libraries: 0 uploaded, 0 skipped, 1 failed.')
        expect(output).toContain('Some symbol files may not been uploaded correctly.')
      })

      test('does not upload a library when another file with its name cannot be read', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
          return // file permissions don't apply
        }
        const unreadable = upath.join(tmpDir, 'a', 'libnative.so')
        copyLibrary('arm64-v8a', unreadable)
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'b', 'libnative.so'))
        fs.chmodSync(unreadable, 0o000)

        const {output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })

        expect(uploadMultipartHelper).not.toHaveBeenCalled()
        expect(output).toContain("Not uploading arm64 libnative.so: another file with this name couldn't be read")
        expect(output).toContain('Native libraries: 0 uploaded, 0 skipped, 2 failed.')
      })

      test('reports folders that cannot be read as failed', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
          return // file permissions don't apply
        }
        copyLibrary('x86', upath.join(tmpDir, 'readable', 'libnative.so'))
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'locked', 'libnative.so'))
        fs.chmodSync(upath.join(tmpDir, 'locked'), 0o000)

        const {exitCode, output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })
        fs.chmodSync(upath.join(tmpDir, 'locked'), 0o755)

        expect(exitCode).toBe(0)
        expect(uploadedPaths()).toEqual([upath.join(tmpDir, 'readable', 'libnative.so')])
        expect(output).toContain(`Could not read the folder ${upath.join(tmpDir, 'locked')}`)
        expect(output).toContain('Native libraries: 1 uploaded, 0 skipped, 1 failed.')
        expect(output).toContain('Some symbol files may not been uploaded correctly.')
      })

      test('reports a location that cannot be read as failed, with the summary', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
          return // file permissions don't apply
        }
        copyLibrary('arm64-v8a', upath.join(tmpDir, 'libnative.so'))
        fs.chmodSync(tmpDir, 0o000)

        const {exitCode, output} = await runCommand((cmd) => {
          cmd['symbolsLocations'] = [tmpDir]
        })
        fs.chmodSync(tmpDir, 0o755)

        expect(exitCode).toBe(0)
        expect(output).toContain(`Could not read the folder ${tmpDir}`)
        expect(output).toContain('Some symbol files may not been uploaded correctly.')
      })
    })
  })
})
