import fs from 'fs'
import os from 'os'

import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import upath from 'upath'

import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {getRepositoryData, TrackedFilesMatcher} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {
  renderArgumentMissingError,
  renderBuildIdFileTooLarge,
  renderBuildIdOptionsError,
  renderBuildIdWithByteOrderMark,
  renderInvalidBuildId,
  renderInvalidMappingFile,
} from '../renderer'
import {JvmMappingSymbolsUploadCommand} from '../upload'

const fixtureDir = 'src/commands/jvm-mapping-symbols/__tests__/fixtures'
const mappingFile = `${fixtureDir}/mapping.txt`
const buildId = '01234567-89ab-cdef-0123-456789abcdef'

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(),
}))

const uploadedPayload = (): MultipartPayload =>
  (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload

const uploadedEvent = () => JSON.parse((uploadedPayload().content.get('event') as MultipartStringValue).value)

describe('jvm-mapping-symbols upload', () => {
  const runCommand = async (prepFunction: (command: JvmMappingSymbolsUploadCommand) => void) => {
    const command = createCommand(JvmMappingSymbolsUploadCommand)
    command['mappingFile'] = mappingFile
    command['buildId'] = buildId
    command['serviceName'] = 'com.example.app'
    command['version'] = '1.2.3'
    command['disableGit'] = true
    prepFunction(command)

    const exitCode = await command.execute()

    return {
      exitCode,
      output: command.context.stdout.toString(),
      errors: command.context.stderr.toString(),
    }
  }

  beforeEach(() => {
    ;(getRepositoryData as jest.Mock).mockReset()
    ;(uploadMultipartHelper as jest.Mock).mockReset()
    ;(uploadMultipartHelper as jest.Mock).mockResolvedValue(UploadStatus.Success)
  })

  describe('parameter validation', () => {
    const runCLI = makeRunCLI(JvmMappingSymbolsUploadCommand, ['jvm-mapping-symbols', 'upload'])
    const requiredArgs = ['--service-name', 'com.example.app', '--version', '1.2.3', '--disable-git']

    test('requires a mapping file', async () => {
      const {code, context} = await runCLI(['--build-id', buildId, ...requiredArgs, '--dry-run'])

      expect(code).not.toBe(0)
      expect(context.stderr.toString()).toContain(renderArgumentMissingError('mapping file'))
    })

    test.each([
      ['does not exist', `${fixtureDir}/does-not-exist.txt`],
      ['is not a file', fixtureDir],
      ['is empty', `${fixtureDir}/empty-mapping.txt`],
    ])('fails if the mapping file %s', async (reason, path) => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['mappingFile'] = path
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderInvalidMappingFile(path, reason))
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })

    test('requires a build ID', async () => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['buildId'] = undefined
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderBuildIdOptionsError())
    })

    test('rejects both --build-id and --build-id-file', async () => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['buildIdFile'] = `${fixtureDir}/datadog.buildId`
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderBuildIdOptionsError())
    })

    test.each(['not-a-uuid', '0123456789abcdef0123456789abcdef', `{${buildId}}`])(
      'rejects the build ID %s',
      async (invalidBuildId) => {
        const {exitCode, errors} = await runCommand((cmd) => {
          cmd['buildId'] = invalidBuildId
        })

        expect(exitCode).not.toBe(0)
        expect(errors).toContain(renderInvalidBuildId(invalidBuildId))
        expect(uploadMultipartHelper).not.toHaveBeenCalled()
      }
    )

    test('rejects an invalid build ID file', async () => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['buildId'] = undefined
        cmd['buildIdFile'] = `${fixtureDir}/invalid.buildId`
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderInvalidBuildId('not-a-uuid'))
    })

    test('fails if the build ID file cannot be read', async () => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['buildId'] = undefined
        cmd['buildIdFile'] = `${fixtureDir}/does-not-exist.buildId`
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(`could not read the build ID file ${fixtureDir}/does-not-exist.buildId`)
    })

    test('rejects a build ID file that starts with a byte order mark', async () => {
      const {exitCode, errors} = await runCommand((cmd) => {
        cmd['buildId'] = undefined
        cmd['buildIdFile'] = `${fixtureDir}/bom.buildId`
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderBuildIdWithByteOrderMark())
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })

    describe('with files made for the test', () => {
      let tmpDir: string

      beforeEach(() => {
        tmpDir = fs.mkdtempSync(upath.join(os.tmpdir(), 'jvm-mapping-symbols-'))
      })

      afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true})
      })

      test('rejects a build ID file too large to be one, without printing it', async () => {
        const path = upath.join(tmpDir, 'mapping.txt')
        fs.writeFileSync(path, 'x'.repeat(10000))

        const {exitCode, errors} = await runCommand((cmd) => {
          cmd['buildId'] = undefined
          cmd['buildIdFile'] = path
        })

        expect(exitCode).not.toBe(0)
        expect(errors).toContain(renderBuildIdFileTooLarge(path))
        expect(errors.length).toBeLessThan(1000)
      })

      test('fails if the mapping file cannot be read', async () => {
        if (process.platform === 'win32' || process.getuid?.() === 0) {
          return // file permissions don't apply
        }
        const path = upath.join(tmpDir, 'mapping.txt')
        fs.copyFileSync(mappingFile, path)
        fs.chmodSync(path, 0o000)

        const {exitCode, errors} = await runCommand((cmd) => {
          cmd['mappingFile'] = path
          cmd['dryRun'] = true
        })

        expect(exitCode).not.toBe(0)
        expect(errors).toContain(renderInvalidMappingFile(path, 'cannot be read'))
      })
    })

    test.each([
      ['service-name', 'serviceName'],
      ['version', 'version'],
    ])('requires a non-empty --%s', async (optionName, field) => {
      const {exitCode, errors} = await runCommand((cmd) => {
        ;(cmd as any)[field] = ' '
      })

      expect(exitCode).not.toBe(0)
      expect(errors).toContain(renderArgumentMissingError(optionName))
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })

    test('runs a dry run without an API key', async () => {
      const {code, context} = await runCLI([mappingFile, '--build-id', buildId, ...requiredArgs, '--dry-run'])

      expect(code).toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(context.stdout.toString()).toContain('[DRYRUN] Handled symbol 1 file with success')
    })
  })

  describe('upload', () => {
    test('uploads the mapping file with its metadata', async () => {
      const {exitCode, output} = await runCommand(() => undefined)

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      expect(uploadedEvent()).toEqual({
        build_id: buildId,
        cli_version: cliVersion,
        service: 'com.example.app',
        type: 'jvm_mapping_file',
        variant: '',
        version: '1.2.3',
      })
      const file = uploadedPayload().content.get('jvm_mapping_file') as MultipartFileValue
      expect(file.path).toBe(mappingFile)
      expect(file.options.filename).toBe('jvm_mapping')
      expect((uploadMultipartHelper as jest.Mock).mock.calls[0][2]).toMatchObject({retries: 5, useGzip: true})
      expect(output).toContain('Uploaded symbol 1 file in')
    })

    test('sends service, version and variant trimmed', async () => {
      await runCommand((cmd) => {
        cmd['serviceName'] = ' com.example.app '
        cmd['version'] = ' 1.2.3 '
        cmd['variant'] = ' prod '
      })

      expect(uploadedEvent()).toMatchObject({service: 'com.example.app', version: '1.2.3', variant: 'prod'})
    })

    test('shows the event payload, also on dry run', async () => {
      const {output} = await runCommand((cmd) => {
        cmd['dryRun'] = true
      })

      expect(output).toContain('Event payload = {"build_id":"01234567-89ab-cdef-0123-456789abcdef"')
    })

    test('sends the variant when given', async () => {
      await runCommand((cmd) => {
        cmd['variant'] = 'prod'
      })

      expect(uploadedEvent().variant).toBe('prod')
    })

    test('reads the build ID from a file, trimmed and otherwise unchanged', async () => {
      await runCommand((cmd) => {
        cmd['buildId'] = undefined
        cmd['buildIdFile'] = `${fixtureDir}/datadog.buildId`
      })

      // The backend compares build IDs exactly, so the case of the ID the app ships is kept.
      expect(uploadedEvent().build_id).toBe('01234567-89AB-CDEF-0123-456789ABCDEF')
    })

    test('attaches the git metadata', async () => {
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher(['./MainActivity.kt']),
      })

      await runCommand((cmd) => {
        cmd['disableGit'] = false
      })

      expect(uploadedEvent()).toMatchObject({git_commit_sha: 'fake-git-hash', git_repository_url: 'fake-git-remote'})
      expect(uploadedPayload().content.get('repository')).toBeDefined()
    })

    test('reports a failed upload in the summary, with exit code 0', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue(UploadStatus.Failure)

      const {exitCode, output} = await runCommand(() => undefined)

      expect(exitCode).toBe(0)
      expect(output).toContain('Some symbol files may not been uploaded correctly.')
    })

    test('does not upload on dry run', async () => {
      const {exitCode, output} = await runCommand((cmd) => {
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
      expect(output).toContain(`[DRYRUN] Uploading JVM mapping file ${mappingFile}`)
    })
  })
})
