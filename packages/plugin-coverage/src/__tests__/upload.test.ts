import {execFileSync} from 'child_process'
import fs from 'fs'
import os from 'os'
import {gunzipSync} from 'zlib'

import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

import {createCommand, createMockContext, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import upath from 'upath'

import {PluginCommand as CoverageUploadCommand} from '../commands/upload'
import {MAX_ATTACHED_FILE_SIZE, gitBlobSha} from '../repo-files'
import {jacocoFormat} from '../utils'

jest.mock('@datadog/datadog-ci-base/helpers/id', () => jest.fn())

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

const CONFIG_CONTENT = 'schema-version: v1\nignore:\n  - "**/test*"\n'

const makeTempDir = () => upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'coverage-upload-')))

const writeFile = (dir: string, relativePath: string, content: string) => {
  const absolutePath = upath.join(dir, relativePath)
  fs.mkdirSync(upath.dirname(absolutePath), {recursive: true})
  fs.writeFileSync(absolutePath, content)

  return absolutePath
}

// A command whose only search root is `root`, with git either absent or returning `blobSha`.
const commandWithSearchRoot = (root: string | undefined, blobSha?: string) => {
  const context = createMockContext()
  const command = createCommand(CoverageUploadCommand, context as any)
  command['repositoryRoot'] = root
  if (blobSha !== undefined) {
    command['git'] = {revparse: jest.fn().mockResolvedValue(blobSha)} as any
  }

  return {command, output: () => context.stdout.toString()}
}

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(CoverageUploadCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
  })

  describe('getMatchingCoverageReportFilesByFormat', () => {
    test('should read all coverage report files and reject invalid ones', () => {
      const command = createCommand(CoverageUploadCommand)
      command['reportPaths'] = ['src/__tests__/fixtures']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(12)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/lcov.info')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.json')
      expect(fileNames).toContain('src/__tests__/fixtures/.resultset.json')
      expect(fileNames).toContain('src/__tests__/fixtures/clover.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/clover-php.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/opencover-coverage.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/cobertura.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.out')
    })

    test('should filter by format', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = jacocoFormat
      command['reportPaths'] = ['src/__tests__/fixtures']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(4)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
    })

    test('should read all coverage report files excluding ignored paths', () => {
      const command = createCommand(CoverageUploadCommand)
      command['ignoredPaths'] = 'src/__tests__/fixtures/subfolder.xml'
      command['reportPaths'] = ['src/__tests__/fixtures']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(9)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/lcov.info')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.json')
      expect(fileNames).toContain('src/__tests__/fixtures/.resultset.json')
      expect(fileNames).toContain('src/__tests__/fixtures/clover.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/clover-php.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.out')
    })

    test('should read all coverage report files excluding ignored paths specified partially', () => {
      const command = createCommand(CoverageUploadCommand)
      command['ignoredPaths'] = 'subfolder.xml'
      command['reportPaths'] = ['src/__tests__/fixtures']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(9)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/lcov.info')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.json')
      expect(fileNames).toContain('src/__tests__/fixtures/.resultset.json')
      expect(fileNames).toContain('src/__tests__/fixtures/clover.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/clover-php.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/coverage.out')
    })

    test('should allow specifying files directly', () => {
      const command = createCommand(CoverageUploadCommand)
      command['reportPaths'] = ['src/__tests__/fixtures/jacoco-report.xml', 'src/__tests__/fixtures/lcov.info']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(2)

      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/lcov.info')
    })

    test('should filter files by format if format is provided', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = 'lcov'
      command['reportPaths'] = ['src/__tests__/fixtures/jacoco-report.xml', 'src/__tests__/fixtures/lcov.info']

      const result = command['getMatchingCoverageReportFilesByFormat']()
      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(1)

      expect(fileNames).toContain('src/__tests__/fixtures/lcov.info')
    })

    test('should not fail for invalid single files', () => {
      const command = createCommand(CoverageUploadCommand)
      command['reportPaths'] = ['src/__tests__/fixtures/does-not-exist.xml']

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(0)
    })

    test('should allow folder and single unit paths', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = jacocoFormat
      command['reportPaths'] = [
        'src/__tests__/fixtures',
        'src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml',
      ]

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(4)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
    })

    test('should not have repeated files', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = jacocoFormat
      command['reportPaths'] = ['src/__tests__/fixtures', 'src/__tests__/fixtures/jacoco-report.xml']

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)

      expect(fileNames.length).toEqual(4)
      expect(fileNames).toContain('src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('src/__tests__/fixtures/kover/report.xml')
    })

    test('should fetch nested folders when using glob patterns', () => {
      const command = createCommand(CoverageUploadCommand)
      command['reportPaths'] = ['**/*.xml']

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(8)
      expect(fileNames).toContain('./src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/clover.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/clover-php.xml')
      // glob matches "subfolder.xml"
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder.xml/opencover-coverage.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder.xml/cobertura.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/kover/report.xml')
    })

    test('should filter by format when using glob patterns', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = 'lcov'
      command['reportPaths'] = ['**']

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(2)
      expect(fileNames).toContain('./src/__tests__/fixtures/lcov.info')
      expect(fileNames).toContain('./src/__tests__/fixtures/lcov-bazel.info')
    })

    test('should fetch nested folders and ignore files that are not coverage reports', () => {
      const command = createCommand(CoverageUploadCommand)
      command['format'] = jacocoFormat
      command['reportPaths'] = ['**']

      const result = command['getMatchingCoverageReportFilesByFormat']()

      const fileNames = Object.values(result).flatMap((paths) => paths)
      expect(fileNames.length).toEqual(4)
      expect(fileNames).toContain('./src/__tests__/fixtures/other-Jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/subfolder.xml/nested-Jacoco-report.xml')
      expect(fileNames).toContain('./src/__tests__/fixtures/kover/report.xml')
    })
  })

  describe('getSpanTags', () => {
    test('should parse DD_ENV environment variable', async () => {
      process.env.DD_ENV = 'ci'
      const context = createMockContext()
      const command = createCommand(CoverageUploadCommand)
      const spanTags: SpanTags = await command['getSpanTags'].call({
        config: {
          env: process.env.DD_ENV,
        },
        context,
      })
      expect(spanTags).toMatchObject({
        env: 'ci',
      })
    })
  })

  describe('disableFileFixes', () => {
    test('should default to false', () => {
      const command = createCommand(CoverageUploadCommand)
      expect(command['disableFileFixes']).toBe(false)
    })
  })

  describe('getRepoFile', () => {
    test('returns undefined when no git is available', async () => {
      const command = createCommand(CoverageUploadCommand)
      command['git'] = undefined

      const result = await command['getRepoFile'].call(command, ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result).toBeUndefined()
    })

    test('returns undefined when no commit ref is available', async () => {
      // Without a commit ref, the (commit, path, file_sha) triple sent to the
      // splitter cannot be made consistent, so we must not ship a blob sha.
      const revparse = jest.fn()
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {revparse} as any

      const result = await command['getRepoFile'].call(command, ['code-coverage.datadog.yml'], undefined)

      expect(result).toBeUndefined()
      expect(revparse).not.toHaveBeenCalled()
    })

    test('resolves the blob sha against the provided ref', async () => {
      const revparse = jest.fn().mockResolvedValue('blob-sha')
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {revparse} as any

      const result = await command['getRepoFile'].call(command, ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result).toEqual({path: 'code-coverage.datadog.yml', sha: 'blob-sha'})
      expect(revparse).toHaveBeenCalledWith(['deadbeef:code-coverage.datadog.yml'])
    })

    test('falls through to the next path when the first does not exist at ref', async () => {
      const revparse = jest.fn().mockRejectedValueOnce(new Error('does not exist')).mockResolvedValueOnce('blob-sha')
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {revparse} as any

      const result = await command['getRepoFile'].call(
        command,
        ['code-coverage.datadog.yml', 'code-coverage.datadog.yaml'],
        'deadbeef'
      )

      expect(result).toEqual({path: 'code-coverage.datadog.yaml', sha: 'blob-sha'})
      expect(revparse).toHaveBeenNthCalledWith(1, ['deadbeef:code-coverage.datadog.yml'])
      expect(revparse).toHaveBeenNthCalledWith(2, ['deadbeef:code-coverage.datadog.yaml'])
    })

    test('swallows the lookup error at debug level by default', async () => {
      const context = createMockContext()
      const command = createCommand(CoverageUploadCommand, context as any)
      command['git'] = {revparse: jest.fn().mockRejectedValue(new Error('does not exist'))} as any

      const result = await command['getRepoFile'](['code-coverage.datadog.yml'], 'deadbeef')

      expect(result).toBeUndefined()
      expect(context.stdout.toString()).not.toContain('does not exist')
    })

    test('warns about the lookup error when the file was explicitly requested', async () => {
      const context = createMockContext()
      const command = createCommand(CoverageUploadCommand, context as any)
      command['git'] = {revparse: jest.fn().mockRejectedValue(new Error('does not exist'))} as any

      const result = await command['getRepoFile'](['build/cc.yml'], 'deadbeef', {explicit: true})

      expect(result).toBeUndefined()
      expect(context.stdout.toString()).toContain(
        'Error while trying to get repo file build/cc.yml details at deadbeef'
      )
    })
  })

  describe('getSearchRoots', () => {
    test('searches the repository root, then --base-path, then the current directory', () => {
      const command = createCommand(CoverageUploadCommand)
      command['repositoryRoot'] = '/repo'
      command['basePath'] = '/repo/build'

      expect(command['getSearchRoots']()).toEqual(['/repo', '/repo/build', CWD])
    })

    test('falls back to the current directory outside of a git repository', () => {
      const command = createCommand(CoverageUploadCommand)
      command['repositoryRoot'] = undefined
      command['basePath'] = undefined

      expect(command['getSearchRoots']()).toEqual([CWD])
    })

    test('deduplicates roots', () => {
      const command = createCommand(CoverageUploadCommand)
      command['repositoryRoot'] = CWD
      command['basePath'] = '.'

      expect(command['getSearchRoots']()).toEqual([CWD])
    })

    test('resolves a relative --base-path against the current directory', () => {
      const command = createCommand(CoverageUploadCommand)
      command['repositoryRoot'] = undefined
      command['basePath'] = 'build/reports'

      expect(command['getSearchRoots']()).toEqual([`${CWD}/build/reports`, CWD])
    })
  })

  describe('resolveRepoFile', () => {
    test('attaches the file found on disk, with a content-derived blob sha', async () => {
      const root = makeTempDir()
      const absolutePath = writeFile(root, 'code-coverage.datadog.yml', CONFIG_CONTENT)
      const {command} = commandWithSearchRoot(root)

      const result = await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result?.path).toBe('code-coverage.datadog.yml')
      expect(result?.sha).toBe(execFileSync('git', ['hash-object', absolutePath], {encoding: 'utf8'}).trim())
      expect(result?.size).toBe(CONFIG_CONTENT.length)
      expect(gunzipSync(result!.gzippedContent!).toString()).toBe(CONFIG_CONTENT)
    })

    test('prefers the on-disk content over the committed blob', async () => {
      const root = makeTempDir()
      writeFile(root, 'code-coverage.datadog.yml', CONFIG_CONTENT)
      const {command} = commandWithSearchRoot(root, 'committed-blob-sha')

      const result = await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result?.sha).toBe(gitBlobSha(Buffer.from(CONFIG_CONTENT)))
      expect(result?.sha).not.toBe('committed-blob-sha')
      expect(result?.gzippedContent).toBeDefined()
    })

    test('reports the same sha as the git lookup when the on-disk file is the committed one', async () => {
      const root = makeTempDir()
      const absolutePath = writeFile(root, 'code-coverage.datadog.yml', CONFIG_CONTENT)
      const committedSha = execFileSync('git', ['hash-object', absolutePath], {encoding: 'utf8'}).trim()
      const {command} = commandWithSearchRoot(root, committedSha)

      const result = await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result?.sha).toBe(committedSha)
    })

    test('keeps the git-derived path and sha when the file is not in the working directory', async () => {
      const {command} = commandWithSearchRoot(makeTempDir(), 'committed-blob-sha')

      const result = await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], 'deadbeef')

      expect(result).toEqual({path: 'code-coverage.datadog.yml', sha: 'committed-blob-sha'})
      expect(result?.gzippedContent).toBeUndefined()
    })

    test('returns undefined when the file is neither committed nor on disk', async () => {
      const {command} = commandWithSearchRoot(makeTempDir())

      expect(await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], 'deadbeef')).toBeUndefined()
    })

    test('does not attach a file over the size cap, and keeps the git-derived path and sha', async () => {
      const root = makeTempDir()
      writeFile(root, 'CODEOWNERS', 'x'.repeat(MAX_ATTACHED_FILE_SIZE + 1))
      const {command, output} = commandWithSearchRoot(root, 'committed-blob-sha')

      const result = await command['resolveRepoFile']('the CODEOWNERS file', ['CODEOWNERS'], 'deadbeef')

      expect(result).toEqual({path: 'CODEOWNERS', sha: 'committed-blob-sha'})
      expect(output()).toContain('Not uploading the content of the CODEOWNERS file')
      expect(output()).toContain(`exceeds the ${MAX_ATTACHED_FILE_SIZE} bytes limit`)
    })

    test('attaches a file exactly at the size cap', async () => {
      const root = makeTempDir()
      writeFile(root, 'CODEOWNERS', 'x'.repeat(MAX_ATTACHED_FILE_SIZE))
      const {command} = commandWithSearchRoot(root)

      const result = await command['resolveRepoFile']('the CODEOWNERS file', ['CODEOWNERS'], 'deadbeef')

      expect(result?.size).toBe(MAX_ATTACHED_FILE_SIZE)
      expect(result?.gzippedContent).toBeDefined()
    })

    test('returns undefined when an oversized file is not committed either', async () => {
      const root = makeTempDir()
      writeFile(root, 'CODEOWNERS', 'x'.repeat(MAX_ATTACHED_FILE_SIZE + 1))
      const {command} = commandWithSearchRoot(root)

      expect(await command['resolveRepoFile']('the CODEOWNERS file', ['CODEOWNERS'], 'deadbeef')).toBeUndefined()
    })

    test('finds CODEOWNERS in its alternative locations', async () => {
      const root = makeTempDir()
      writeFile(root, 'docs/CODEOWNERS', '* @team\n')
      const {command} = commandWithSearchRoot(root)

      const result = await command['resolveRepoFile'](
        'the CODEOWNERS file',
        ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'],
        'deadbeef'
      )

      expect(result?.path).toBe('docs/CODEOWNERS')
      expect(gunzipSync(result!.gzippedContent!).toString()).toBe('* @team\n')
    })

    test('works without git, computing the sha from the working-directory content', async () => {
      const root = makeTempDir()
      writeFile(root, 'code-coverage.datadog.yml', CONFIG_CONTENT)
      const {command} = commandWithSearchRoot(root)
      command['git'] = undefined

      const result = await command['resolveRepoFile']('the config', ['code-coverage.datadog.yml'], undefined)

      expect(result?.sha).toBe(gitBlobSha(Buffer.from(CONFIG_CONTENT)))
    })

    test('logs what it attached and what it did not', async () => {
      const root = makeTempDir()
      writeFile(root, 'code-coverage.datadog.yml', CONFIG_CONTENT)
      const {command, output} = commandWithSearchRoot(root)

      await command['resolveRepoFile']('the code coverage configuration', ['code-coverage.datadog.yml'], undefined)

      expect(output()).toContain('Uploading the code coverage configuration code-coverage.datadog.yml')
      expect(output()).toContain(`${CONFIG_CONTENT.length} bytes`)
    })

    test('logs that only the path is sent when the file is only committed', async () => {
      const {command, output} = commandWithSearchRoot(makeTempDir(), 'committed-blob-sha')

      await command['resolveRepoFile']('the code coverage configuration', ['code-coverage.datadog.yml'], 'deadbeef')

      expect(output()).toContain('Not uploading the content of the code coverage configuration')
      expect(output()).toContain('it will be read from the repository instead')
    })

    test('does not claim the file is missing from the working directory when it is only oversized', async () => {
      const root = makeTempDir()
      writeFile(root, 'CODEOWNERS', 'x'.repeat(MAX_ATTACHED_FILE_SIZE + 1))
      const {command, output} = commandWithSearchRoot(root, 'committed-blob-sha')

      await command['resolveRepoFile']('the CODEOWNERS file', ['CODEOWNERS'], 'deadbeef')

      expect(output()).not.toContain('not in the working directory')
    })
  })

  describe('resolveCoverageConfig', () => {
    test('warns when no configuration is found anywhere', async () => {
      const {command, output} = commandWithSearchRoot(makeTempDir())

      expect(await command['resolveCoverageConfig']('deadbeef')).toBeUndefined()
      expect(output()).toContain('No code coverage configuration found')
      expect(output()).toContain('in the files committed at deadbeef')
      expect(output()).toContain('the organization-level configuration will be used')
      expect(output()).toContain('--coverage-config')
    })

    test('does not warn when a configuration is found', async () => {
      const root = makeTempDir()
      writeFile(root, 'code-coverage.datadog.yaml', CONFIG_CONTENT)
      const {command, output} = commandWithSearchRoot(root)

      expect((await command['resolveCoverageConfig']('deadbeef'))?.path).toBe('code-coverage.datadog.yaml')
      expect(output()).not.toContain('No code coverage configuration found')
    })

    test('mentions the searched directories when there is no commit', async () => {
      const root = makeTempDir()
      const {command, output} = commandWithSearchRoot(root)

      expect(await command['resolveCoverageConfig'](undefined)).toBeUndefined()
      expect(output()).toContain(root)
      expect(output()).not.toContain('in the files committed at')
    })

    test('uses the file resolved from --coverage-config without searching', async () => {
      const {command} = commandWithSearchRoot(makeTempDir(), 'committed-blob-sha')
      command['coverageConfigPath'] = 'build/cc.yml'
      command['explicitCoverageConfig'] = {path: 'build/cc.yml', sha: 'explicit-sha', gzippedContent: Buffer.from('gz')}

      const result = await command['resolveCoverageConfig']('deadbeef')

      expect(result).toEqual({path: 'build/cc.yml', sha: 'explicit-sha', gzippedContent: Buffer.from('gz')})
      expect(command['git']!.revparse).not.toHaveBeenCalled()
    })

    test('falls back to the committed blob of the explicit path when the file is too large', async () => {
      const root = makeTempDir()
      const {command} = commandWithSearchRoot(root, 'committed-blob-sha')
      command['coverageConfigPath'] = upath.join(root, 'build/cc.yml')
      command['explicitCoverageConfig'] = undefined

      const result = await command['resolveCoverageConfig']('deadbeef')

      expect(result).toEqual({path: 'build/cc.yml', sha: 'committed-blob-sha'})
      expect(command['git']!.revparse).toHaveBeenCalledWith(['deadbeef:build/cc.yml'])
    })
  })

  describe('readCoverageConfigFile', () => {
    test('reads the file, attaches it, and reports a repository-relative path', () => {
      const root = makeTempDir()
      const absolutePath = writeFile(root, 'build/generated/cc.yml', CONFIG_CONTENT)
      const {command} = commandWithSearchRoot(root)

      const result = command['readCoverageConfigFile'](absolutePath)

      expect(result?.path).toBe('build/generated/cc.yml')
      expect(result?.sha).toBe(gitBlobSha(Buffer.from(CONFIG_CONTENT)))
      expect(gunzipSync(result!.gzippedContent!).toString()).toBe(CONFIG_CONTENT)
    })

    test('keeps the absolute path when the file is outside the repository', () => {
      const root = makeTempDir()
      const absolutePath = writeFile(makeTempDir(), 'cc.yml', CONFIG_CONTENT)
      const {command} = commandWithSearchRoot(root)

      expect(command['readCoverageConfigFile'](absolutePath)?.path).toBe(absolutePath)
    })

    test('resolves a relative path against the current directory', () => {
      const {command} = commandWithSearchRoot(CWD)

      const result = command['readCoverageConfigFile']('src/__tests__/fixtures/jacoco-report.xml')

      expect(result?.path).toBe('src/__tests__/fixtures/jacoco-report.xml')
    })

    test('throws when the file does not exist', () => {
      const {command} = commandWithSearchRoot(makeTempDir())

      expect(() => command['readCoverageConfigFile']('does/not/exist.yml')).toThrow('no readable file at')
    })

    test('throws when the path is a directory', () => {
      const root = makeTempDir()
      const {command} = commandWithSearchRoot(root)

      expect(() => command['readCoverageConfigFile'](root)).toThrow('no readable file at')
    })

    test('does not attach a file over the size cap, and warns', () => {
      const root = makeTempDir()
      const absolutePath = writeFile(root, 'build/cc.yml', 'x'.repeat(MAX_ATTACHED_FILE_SIZE + 1))
      const {command, output} = commandWithSearchRoot(root)

      expect(command['readCoverageConfigFile'](absolutePath)).toBeUndefined()
      expect(output()).toContain('Not uploading the content of the code coverage configuration')
      expect(output()).toContain('build/cc.yml')
    })
  })

  describe('generatePayloads', () => {
    const setUpForBudget = (
      reportCount: number,
      resolved: {
        coverageConfig?: boolean
        codeowners?: boolean
        prDiff?: boolean
        commitDiff?: boolean
        fileFixes?: boolean
      }
    ) => {
      const command = createCommand(CoverageUploadCommand)
      const paths = Array.from({length: reportCount}, (_, i) => `report-${i}.xml`)

      jest.spyOn(command as any, 'getMatchingCoverageReportFilesByFormat').mockReturnValue({jacoco: paths})
      jest
        .spyOn(command as any, 'resolveCoverageConfig')
        .mockResolvedValue(
          resolved.coverageConfig ? {path: 'cc.yml', sha: 'sha', gzippedContent: Buffer.from('gz')} : undefined
        )
      jest
        .spyOn(command as any, 'resolveRepoFile')
        .mockResolvedValue(
          resolved.codeowners ? {path: 'CODEOWNERS', sha: 'sha', gzippedContent: Buffer.from('gz')} : undefined
        )
      jest.spyOn(command as any, 'getPrDiff').mockResolvedValue(resolved.prDiff ? {files: {}} : undefined)
      jest.spyOn(command as any, 'getCommitDiff').mockResolvedValue(resolved.commitDiff ? {files: {}} : undefined)
      jest.spyOn(command as any, 'getFileFixes').mockResolvedValue(resolved.fileFixes ? {'a.go': {}} : undefined)

      return command
    }

    test('reserves nothing when only reports are uploaded', async () => {
      const command = setUpForBudget(10, {})

      const payloads = await command['generatePayloads']({} as SpanTags)

      expect(payloads).toHaveLength(1)
      expect(payloads[0].paths).toHaveLength(10)
    })

    test('reserves one slot per attachment that is actually sent', async () => {
      const command = setUpForBudget(10, {coverageConfig: true, codeowners: true, prDiff: true})

      const payloads = await command['generatePayloads']({} as SpanTags)

      // 10 - 3 reserved = 7 reports per request
      expect(payloads).toHaveLength(2)
      expect(payloads[0].paths).toHaveLength(7)
      expect(payloads[1].paths).toHaveLength(3)
    })

    test('reserves five slots when every optional attachment is present', async () => {
      const command = setUpForBudget(11, {
        coverageConfig: true,
        codeowners: true,
        prDiff: true,
        commitDiff: true,
        fileFixes: true,
      })

      const payloads = await command['generatePayloads']({} as SpanTags)

      expect(payloads).toHaveLength(3)
      expect(payloads.map((payload) => payload.paths.length)).toEqual([5, 5, 1])
    })

    test('does not reserve a slot for a file that has no attached content', async () => {
      const command = setUpForBudget(9, {})
      jest.spyOn(command as any, 'resolveCoverageConfig').mockResolvedValue({path: 'cc.yml', sha: 'committed-sha'})
      jest.spyOn(command as any, 'resolveRepoFile').mockResolvedValue({path: 'CODEOWNERS', sha: 'committed-sha'})

      const payloads = await command['generatePayloads']({} as SpanTags)

      expect(payloads).toHaveLength(1)
      expect(payloads[0].paths).toHaveLength(9)
    })

    test('uploads every report even when the reserved slots take most of the budget', async () => {
      const command = setUpForBudget(3, {
        coverageConfig: true,
        codeowners: true,
        prDiff: true,
        commitDiff: true,
        fileFixes: true,
      })

      const payloads = await command['generatePayloads']({} as SpanTags)

      expect(payloads.every((payload) => payload.paths.length >= 1)).toBe(true)
      expect(payloads.flatMap((payload) => payload.paths)).toHaveLength(3)
    })

    test('carries the resolved files on every chunk', async () => {
      const command = setUpForBudget(20, {coverageConfig: true, codeowners: true})

      const payloads = await command['generatePayloads']({} as SpanTags)

      expect(payloads.length).toBeGreaterThan(1)
      for (const payload of payloads) {
        expect(payload.coverageConfig?.gzippedContent).toBeDefined()
        expect(payload.codeowners?.gzippedContent).toBeDefined()
      }
    })
  })

  describe('getFlags', () => {
    test('should return undefined when no flags provided', () => {
      const command = createCommand(CoverageUploadCommand)
      command['flags'] = undefined
      expect(command['getFlags']()).toBeUndefined()
    })

    test('should return undefined when empty flags array provided', () => {
      const command = createCommand(CoverageUploadCommand)
      command['flags'] = []
      expect(command['getFlags']()).toBeUndefined()
    })

    test('should return flags array when flags provided', () => {
      const command = createCommand(CoverageUploadCommand)
      command['flags'] = ['type:unit-tests', 'jvm-21']
      expect(command['getFlags']()).toEqual(['type:unit-tests', 'jvm-21'])
    })

    test('should throw error when more than 32 flags provided', () => {
      const command = createCommand(CoverageUploadCommand)
      command['flags'] = Array.from({length: 33}, (_, i) => `flag${i}`)
      expect(() => command['getFlags']()).toThrow('Maximum of 32 flags per report allowed, but 33 flags were provided')
    })

    test('should accept exactly 32 flags', () => {
      const command = createCommand(CoverageUploadCommand)
      command['flags'] = Array.from({length: 32}, (_, i) => `flag${i}`)
      expect(command['getFlags']()).toHaveLength(32)
    })
  })
})

describe('execute', () => {
  const runCLI = makeRunCLI(CoverageUploadCommand, ['coverage', 'upload', '--dry-run'])

  test('relative path with double dots', async () => {
    const {context, code} = await runCLI(['src/__tests__/doesnotexist/../fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      reportPaths: ['src/__tests__/fixtures'],
    })
  })

  test('multiple paths', async () => {
    const {context, code} = await runCLI(['src/commands/coverage/first/', 'src/commands/coverage/second/'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      reportPaths: ['src/commands/coverage/first/', 'src/commands/coverage/second/'],
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures'])
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      reportPaths: [`${CWD}/src/__tests__/fixtures`],
    })
  })

  test('single file', async () => {
    const {context, code} = await runCLI([CWD + '/src/__tests__/fixtures/single_file.xml'])
    const output = context.stdout.toString().split('\n')
    const path = `${CWD}/src/__tests__/fixtures/single_file.xml`
    expect(code).toBe(0)
    expect(output[0]).toContain('[DRYRUN] Syncing git metadata...')
    // output[1] is "Synced git metadata in XXX seconds"
    expect(output[2]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
    expect(output[3]).toContain('Starting upload')
    expect(output[4]).toContain(`Will upload code coverage report file ${path}`)
  })

  test('should accept --disable-file-fixes flag', async () => {
    const runCLIWithFlag = makeRunCLI(CoverageUploadCommand, [
      'coverage',
      'upload',
      '--dry-run',
      '--disable-file-fixes',
    ])
    const {code} = await runCLIWithFlag(['src/__tests__/fixtures'])
    expect(code).toBe(0)
  })

  test('should upload with flags in dry-run mode', async () => {
    const runCLIWithFlags = makeRunCLI(CoverageUploadCommand, [
      'coverage',
      'upload',
      '--dry-run',
      '--flags',
      'type:unit-tests',
      '--flags',
      'jvm-21',
    ])
    const {context, code} = await runCLIWithFlags(['src/__tests__/fixtures'])
    expect(code).toBe(0)
    const output = context.stdout.toString()
    expect(output).toContain('type:unit-tests')
    expect(output).toContain('jvm-21')
  })

  describe('--coverage-config', () => {
    const runCLIWithConfig = (configPath: string) =>
      makeRunCLI(CoverageUploadCommand, ['coverage', 'upload', '--dry-run', '--coverage-config', configPath])([
        'src/__tests__/fixtures/jacoco-report.xml',
      ])

    test('fails without uploading anything when the file is missing', async () => {
      const {context, code} = await runCLIWithConfig('does/not/exist.yml')

      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Could not read the code coverage configuration file')
      expect(context.stderr.toString()).toContain('does/not/exist.yml')
      // nothing was uploaded, not even git metadata
      expect(context.stdout.toString()).not.toContain('Syncing git metadata')
      expect(context.stdout.toString()).not.toContain('Starting upload')
    })

    test('fails when the path is a directory', async () => {
      const {context, code} = await runCLIWithConfig('src/__tests__/fixtures')

      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Could not read the code coverage configuration file')
    })

    test('fails when the file cannot be read', async () => {
      // a dangling symlink is unreadable for every user, unlike a chmod that root ignores
      const dir = makeTempDir()
      const configPath = upath.join(dir, 'code-coverage.datadog.yml')
      fs.symlinkSync(upath.join(dir, 'generated-later.yml'), configPath)

      const {context, code} = await runCLIWithConfig(configPath)

      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Could not read the code coverage configuration file')
      expect(context.stdout.toString()).not.toContain('Starting upload')
    })

    test('attaches the file and reports it in dry-run mode', async () => {
      const configPath = writeFile(makeTempDir(), 'generated-config.yml', CONFIG_CONTENT)

      const {context, code} = await runCLIWithConfig(configPath)
      const output = context.stdout.toString()

      expect(code).toBe(0)
      expect(output).toContain('[DRYRUN] Uploading the code coverage configuration')
      expect(output).toContain(`${CONFIG_CONTENT.length} bytes`)
      expect(output).toContain(gitBlobSha(Buffer.from(CONFIG_CONTENT)))
      expect(output).toContain('Uploaded 1 files')
    })
  })

  test('reports the CODEOWNERS file it would attach in dry-run mode', async () => {
    // this repository has a .github/CODEOWNERS, so the working-directory lookup finds it
    const {context, code} = await makeRunCLI(CoverageUploadCommand, ['coverage', 'upload', '--dry-run'])([
      'src/__tests__/fixtures/jacoco-report.xml',
    ])
    const output = context.stdout.toString()

    expect(code).toBe(0)
    expect(output).toContain('[DRYRUN] Uploading the CODEOWNERS file .github/CODEOWNERS')
  })

  test('warns when no coverage configuration can be resolved', async () => {
    // this repository has no code-coverage.datadog.yml
    const {context, code} = await makeRunCLI(CoverageUploadCommand, ['coverage', 'upload', '--dry-run'])([
      'src/__tests__/fixtures/jacoco-report.xml',
    ])
    const output = context.stdout.toString()

    expect(code).toBe(0)
    expect(output).toContain('No code coverage configuration found')
    expect(output).toContain('the organization-level configuration will be used')
  })
})

interface ExpectedOutput {
  reportPaths: string[]
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('[DRYRUN] Syncing git metadata...')
  // output[1] is "Synced git metadata in XXX seconds"
  expect(output[2]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT')
  expect(output[3]).toContain(`Starting upload`)
  expect(output[4]).toContain(`Will look for code coverage report files in ${expected.reportPaths.join(', ')}`)
}
