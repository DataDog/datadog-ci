import fs from 'fs'
import {gunzipSync} from 'zlib'

import type {Payload} from '../interfaces'
import type {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'

import {createCommand, createMockContext, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import upath from 'upath'

import {PluginCommand as CoverageUploadCommand} from '../commands/upload'
import {jacocoFormat} from '../utils'

jest.mock('@datadog/datadog-ci-base/helpers/id', () => jest.fn())

// Always posix, even on Windows.
const CWD = upath.normalize(process.cwd())

const COVERAGE_CONFIG_FIXTURE = 'src/__tests__/fixtures/code-coverage.datadog.yml'

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

  describe('readLocalCoverageConfig', () => {
    test('reads and gzips the contents of the local file', () => {
      const command = createCommand(CoverageUploadCommand)

      const result = command['readLocalCoverageConfig'](COVERAGE_CONFIG_FIXTURE)

      expect(result.source).toEqual('local')
      expect(result.path).toEqual(COVERAGE_CONFIG_FIXTURE)
      expect(gunzipSync(result.compressed).toString('utf8')).toEqual(fs.readFileSync(COVERAGE_CONFIG_FIXTURE, 'utf8'))
    })

    test('throws when the file does not exist', () => {
      const command = createCommand(CoverageUploadCommand)

      expect(() => command['readLocalCoverageConfig']('src/__tests__/fixtures/does-not-exist.yml')).toThrow('ENOENT')
    })

    test('throws when the file is empty', () => {
      const command = createCommand(CoverageUploadCommand)

      expect(() => command['readLocalCoverageConfig']('src/__tests__/fixtures/empty-coverage-config.yml')).toThrow(
        'file is empty or is not a YAML mapping'
      )
    })

    test('throws when the file is not YAML', () => {
      const command = createCommand(CoverageUploadCommand)

      expect(() => command['readLocalCoverageConfig']('src/__tests__/fixtures/jacoco-report.xml')).toThrow(
        'file is empty or is not a YAML mapping'
      )
    })
  })

  describe('getCoverageConfig', () => {
    test('resolves the config from the repository when --coverage-config is not set', async () => {
      const revparse = jest.fn().mockResolvedValue('blob-sha')
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {revparse} as any

      const result = await command['getCoverageConfig'].call(command, 'deadbeef')

      expect(result).toEqual({source: 'repository', path: 'code-coverage.datadog.yml', sha: 'blob-sha'})
      expect(revparse).toHaveBeenCalledWith(['deadbeef:code-coverage.datadog.yml'])
    })

    test('returns the local config without consulting git when --coverage-config is set', async () => {
      const revparse = jest.fn()
      const command = createCommand(CoverageUploadCommand)
      command['git'] = {revparse} as any
      command['coverageConfigPath'] = COVERAGE_CONFIG_FIXTURE
      command['localCoverageConfig'] = command['readLocalCoverageConfig'](COVERAGE_CONFIG_FIXTURE)

      const result = await command['getCoverageConfig'].call(command, 'deadbeef')

      expect(result).toEqual(command['localCoverageConfig'])
      expect(revparse).not.toHaveBeenCalled()
    })

    test('returns the local config even when there is no git repository', async () => {
      const command = createCommand(CoverageUploadCommand)
      command['git'] = undefined
      command['coverageConfigPath'] = COVERAGE_CONFIG_FIXTURE
      command['localCoverageConfig'] = command['readLocalCoverageConfig'](COVERAGE_CONFIG_FIXTURE)

      const result = await command['getCoverageConfig'].call(command, undefined)

      expect(result).toEqual(command['localCoverageConfig'])
    })
  })

  describe('generatePayloads', () => {
    const generatePayloadsForReports = async (reportCount: number, coverageConfigPath?: string) => {
      const command = createCommand(CoverageUploadCommand)
      jest.spyOn(command as any, 'getMatchingCoverageReportFilesByFormat').mockReturnValue({
        jacoco: Array.from({length: reportCount}, (_, i) => `report-${i}.xml`),
      })
      if (coverageConfigPath) {
        command['coverageConfigPath'] = coverageConfigPath
        command['localCoverageConfig'] = command['readLocalCoverageConfig'](coverageConfigPath)
      }

      return command['generatePayloads']({})
    }

    test('sends at most 7 reports per payload when the config comes from the repository', async () => {
      const payloads = await generatePayloadsForReports(8)

      expect(payloads.map((payload) => payload.paths.length)).toEqual([7, 1])
    })

    test('sends at most 6 reports per payload when the config is uploaded as an attachment', async () => {
      const payloads = await generatePayloadsForReports(8, COVERAGE_CONFIG_FIXTURE)

      expect(payloads.map((payload) => payload.paths.length)).toEqual([6, 2])
      expect(payloads.every((payload) => payload.coverageConfig?.source === 'local')).toBe(true)
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

  afterEach(() => {
    jest.restoreAllMocks()
  })

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

  test('should upload the contents of the file passed to --coverage-config', async () => {
    const uploadSpy = jest.spyOn(CoverageUploadCommand.prototype as any, 'uploadCodeCoverageReport')
    const runCLIWithFlag = makeRunCLI(CoverageUploadCommand, [
      'coverage',
      'upload',
      '--dry-run',
      '--coverage-config',
      COVERAGE_CONFIG_FIXTURE,
    ])
    const {code} = await runCLIWithFlag(['src/__tests__/fixtures'])
    expect(code).toBe(0)

    const payloads = uploadSpy.mock.calls.map((call) => call[1] as Payload)
    expect(payloads.length).toBeGreaterThan(0)
    for (const payload of payloads) {
      expect(payload.coverageConfig).toEqual({
        source: 'local',
        path: COVERAGE_CONFIG_FIXTURE,
        compressed: expect.any(Buffer),
      })
    }

    const coverageConfig = payloads[0].coverageConfig
    if (coverageConfig?.source !== 'local') {
      throw new Error('expected a local coverage config')
    }
    expect(gunzipSync(coverageConfig.compressed).toString('utf8')).toEqual(
      fs.readFileSync(COVERAGE_CONFIG_FIXTURE, 'utf8')
    )
  })

  test('should not upload any config contents when --coverage-config is not set', async () => {
    const uploadSpy = jest.spyOn(CoverageUploadCommand.prototype as any, 'uploadCodeCoverageReport')
    const {code} = await runCLI(['src/__tests__/fixtures'])
    expect(code).toBe(0)

    const payloads = uploadSpy.mock.calls.map((call) => call[1] as Payload)
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads.every((payload) => payload.coverageConfig?.source !== 'local')).toBe(true)
  })

  test('should fail when --coverage-config points at a missing file', async () => {
    const runCLIWithFlag = makeRunCLI(CoverageUploadCommand, [
      'coverage',
      'upload',
      '--dry-run',
      '--coverage-config',
      'src/__tests__/fixtures/does-not-exist.yml',
    ])
    const {context, code} = await runCLIWithFlag(['src/__tests__/fixtures'])
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'Could not read coverage config file src/__tests__/fixtures/does-not-exist.yml'
    )
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
