import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

import {createCommand, createMockContext, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import upath from 'upath'

import {PluginCommand as CoverageUploadCommand} from '../commands/upload'
import {jacocoFormat} from '../utils'

jest.mock('@datadog/datadog-ci-base/helpers/id', () => jest.fn())

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

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
  })

  describe('getHeadAndBase', () => {
    const HEAD_SHA = 'aabbccdd11223344556677889900aabbccdd1122'
    const BASE_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    const MERGE_BASE = '1234567890abcdef1234567890abcdef12345678'

    test('returns empty when headSha is missing', async () => {
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {} as any
      const result = await command['getHeadAndBase'].call(command, {})
      expect(result).toEqual({})
    })

    test('returns empty when git is not available', async () => {
      const command = createCommand(CoverageUploadCommand)
      command['git'] = undefined
      const result = await command['getHeadAndBase'].call(command, {'git.commit.head.sha': HEAD_SHA})
      expect(result).toEqual({})
    })

    test('uses baseSha path and skips fetch when baseSha is provided directly', async () => {
      const raw = jest.fn().mockResolvedValue(`${MERGE_BASE}\n`)
      const fetch = jest.fn()
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {raw, fetch} as any
      const result = await command['getHeadAndBase'].call(command, {
        'git.commit.head.sha': HEAD_SHA,
        'git.pull_request.base_branch_sha': BASE_SHA,
      })
      expect(fetch).not.toHaveBeenCalled()
      expect(result.headSha).toBe(HEAD_SHA)
      expect(result.baseSha).toBe(MERGE_BASE)
    })

    test('fetches base branch before merge-base when only branch name is available', async () => {
      const raw = jest.fn().mockResolvedValue(`${MERGE_BASE}\n`)
      const fetch = jest.fn().mockResolvedValue(undefined)
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {raw, fetch} as any
      const result = await command['getHeadAndBase'].call(command, {
        'git.commit.head.sha': HEAD_SHA,
        'git.pull_request.base_branch': 'main',
      })
      expect(fetch).toHaveBeenCalledWith(['origin', 'main'])
      expect(result.headSha).toBe(HEAD_SHA)
      expect(result.baseSha).toBe(MERGE_BASE)
    })

    test('degrades gracefully when fetch fails', async () => {
      const raw = jest.fn().mockResolvedValue(`${MERGE_BASE}\n`)
      const fetch = jest.fn().mockRejectedValue(new Error('fetch failed'))
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {raw, fetch} as any
      const result = await command['getHeadAndBase'].call(command, {
        'git.commit.head.sha': HEAD_SHA,
        'git.pull_request.base_branch': 'main',
      })
      // fetch error is swallowed; merge-base still attempted
      expect(fetch).toHaveBeenCalledWith(['origin', 'main'])
      expect(result.headSha).toBe(HEAD_SHA)
      expect(result.baseSha).toBe(MERGE_BASE)
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
