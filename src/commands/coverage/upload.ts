import os from 'os'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import * as t from 'typanion'
import upath from 'upath'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {getCISpanTags} from '../../helpers/ci'
import {toBoolean} from '../../helpers/env'
import {findFiles} from '../../helpers/file-finder'
import {enableFips} from '../../helpers/fips'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {parsePathsList} from '../../helpers/glob'
import {SpanTags} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import {
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
  parseMetrics,
  parseTags,
} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {newSimpleGit, getGitDiff, DiffData} from '../git-metadata/git'

import {apiConstructor, intakeUrl} from './api'
import {APIHelper, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderRetriedUpload,
  renderSuccessfulUpload,
  renderSuccessfulUploadCommand,
  renderUpload,
} from './renderer'
import {detectFormat, validateCoverageReport} from './utils'

const errorCodesStopUpload = [400, 403]

const MAX_REPORTS_PER_REQUEST = 8 // backend supports 10 attachments, to keep the logic simple we subtract 2: for PR diff and commit diff

const isCoverageReport = (file: string): boolean => {
  if (upath.extname(file) !== '.xml') {
    return false
  }

  const filename = upath.basename(file)

  return (
    filename.startsWith('jacoco') || filename.includes('Jacoco') // jacoco*.xml, *Jacoco*.xml
  )
}

const validateReport = (explicitFormat: string | undefined, file: string): string | undefined => {
  const format = explicitFormat || detectFormat(file)
  if (format === undefined) {
    return `Could not detect format of ${file}, please specify the format manually using the --format option`
  }

  return validateCoverageReport(file, format)
}

export class UploadCodeCoverageReportCommand extends Command {
  public static paths = [['coverage', 'upload']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Upload code coverage reports files to Datadog.',
    details: `
      This command will upload code coverage report files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all code coverage report files in current directory and its subfolders', 'datadog-ci coverage upload .'],
      [
        'Upload all code coverage report files in current directory and its subfolders, ignoring src/ignored-module-a and src/ignored-module-b',
        'datadog-ci coverage upload --ignored-paths src/ignored-module-a,src/ignored-module-b .',
      ],
      [
        'Upload all code coverage report files in src/unit-test-coverage and src/acceptance-test-coverage',
        'datadog-ci coverage upload src/unit-test-coverage src/acceptance-test-coverage',
      ],
      [
        'Upload all code coverage report files in current directory and add extra tags globally',
        'datadog-ci coverage upload --tags key1:value1 --tags key2:value2 .',
      ],
      [
        'Upload all code coverage report files in current directory and add extra measures globally',
        'datadog-ci coverage upload --measures key1:123 --measures key2:321 .',
      ],
      [
        'Upload all code coverage report files in current directory to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci coverage upload .',
      ],
      [
        'Upload all code coverage report files in current directory with extra verbosity',
        'datadog-ci coverage upload --verbose .',
      ],
    ],
  })

  private basePaths = Option.Rest({required: 1})
  private verbose = Option.Boolean('--verbose', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private measures = Option.Array('--measures')
  private tags = Option.Array('--tags')
  private format = Option.String('--format')
  private uploadGitDiff = Option.Boolean('--upload-git-diff', true)

  private automaticReportsDiscovery = Option.String('--auto-discovery', 'true', {
    validator: t.isBoolean(),
    tolerateBoolean: true,
  })
  private ignoredPaths = Option.String('--ignored-paths')

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMeasures: process.env.DD_MEASURES,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    if (!this.basePaths.length) {
      this.context.stderr.write('Positional arguments must be provided\n')

      return 1
    }

    await this.uploadCodeCoverageReports()
  }

  private async uploadCodeCoverageReports() {
    // Normalizing the basePath to resolve .. and .
    this.basePaths = this.basePaths.map((basePath) => upath.normalize(basePath))

    this.logger.info(renderCommandInfo(this.basePaths, this.dryRun))

    const spanTags = await this.getSpanTags()
    const api = this.getApiHelper()
    const payloads = await this.generatePayloads(spanTags)

    let fileCount = 0

    const initialTime = new Date().getTime()
    for (const payload of payloads) {
      fileCount += payload.paths.length
      await this.uploadCodeCoverageReport(api, payload)
    }
    const totalTimeSeconds = (Date.now() - initialTime) / 1000

    this.logger.info(renderSuccessfulUpload(this.dryRun, fileCount, totalTimeSeconds))

    if (!this.dryRun) {
      this.context.stdout.write(renderSuccessfulUploadCommand(spanTags))
    }
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(intakeUrl, this.config.apiKey)
  }

  private async generatePayloads(spanTags: SpanTags): Promise<Payload[]> {
    const customTags = this.getCustomTags()
    const customMeasures = this.getCustomMeasures()

    if (!!customTags['resolved']) {
      throw new Error('"resolved" is a reserved tag name, please avoid using it in your custom tags')
    }

    const commitDiff = await this.getCommitDiff(spanTags)
    const prDiff = await this.getPrDiff(spanTags)
    const reports = this.getMatchingCoverageReportFilesByFormat()

    let payloads: Payload[] = []
    if (Object.keys(reports).length) {
      payloads = Object.entries(reports).flatMap(([format, paths]) => {
        const numChunks = Math.ceil(paths.length / MAX_REPORTS_PER_REQUEST)

        return Array.from({length: numChunks}, (_, i) => ({
          format,
          paths: paths.slice(i * MAX_REPORTS_PER_REQUEST, (i + 1) * MAX_REPORTS_PER_REQUEST),
          spanTags,
          customTags,
          customMeasures,
          hostname: os.hostname(),
          commitDiff,
          prDiff,
        }))
      })
    }

    return payloads
  }

  private async getPrDiff(spanTags: SpanTags): Promise<DiffData | undefined> {
    if (!this.uploadGitDiff) {
      return undefined
    }

    const baseCommit = spanTags[GIT_PULL_REQUEST_BASE_BRANCH_SHA]
    const headCommit = spanTags[GIT_HEAD_SHA] || spanTags[GIT_SHA]
    if (!baseCommit || !headCommit) {
      return undefined
    }

    try {
      const git = await newSimpleGit()

      return await getGitDiff(git, baseCommit, headCommit)
    } catch (e) {
      this.logger.debug(`Error while trying to calculate PR diff: ${e}`)

      return undefined
    }
  }

  private async getCommitDiff(spanTags: SpanTags): Promise<DiffData | undefined> {
    if (!this.uploadGitDiff) {
      return undefined
    }

    const commit = spanTags[GIT_HEAD_SHA] || spanTags[GIT_SHA]
    if (!commit) {
      return undefined
    }

    try {
      const git = await newSimpleGit()

      return await getGitDiff(git, commit + '^', commit)
    } catch (e) {
      this.logger.debug(`Error while trying to calculate commit diff: ${e}`)

      return undefined
    }
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    const spanTags = {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...(this.config.env ? {env: this.config.env} : {}),
    }

    if (!spanTags[GIT_REPOSITORY_URL]) {
      throw new Error('git repository URL is missing')
    }

    if (!spanTags[GIT_SHA]) {
      throw new Error('git commit SHA is missing')
    }

    return spanTags
  }

  private getCustomTags(): Record<string, string> {
    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    return {
      ...cliTags,
      ...envVarTags,
    }
  }

  private getCustomMeasures(): Record<string, number> {
    const envVarMeasures = this.config.envVarMeasures ? parseMetrics(this.config.envVarMeasures.split(',')) : {}
    const cliMeasures = this.measures ? parseMetrics(this.measures) : {}

    return {
      ...cliMeasures,
      ...envVarMeasures,
    }
  }

  private getMatchingCoverageReportFilesByFormat(): {[key: string]: string[]} {
    const validUniqueFiles = findFiles(
      this.basePaths || ['.'],
      this.automaticReportsDiscovery,
      parsePathsList(this.ignoredPaths),
      isCoverageReport,
      (filePath: string) => validateReport(this.format, filePath),
      (filePath: string, errorMessage: string) => this.context.stdout.write(renderInvalidFile(filePath, errorMessage))
    )

    const pathsByFormat: {[key: string]: string[]} = {}
    for (const file of validUniqueFiles) {
      const format = this.format || detectFormat(file)
      if (format === undefined) {
        // should not be possible, such files will fail validation
        continue
      }
      pathsByFormat[format] = pathsByFormat[format] || []
      pathsByFormat[format].push(file)
    }

    return pathsByFormat
  }

  private async uploadCodeCoverageReport(api: APIHelper, codeCoverageReport: Payload) {
    if (this.dryRun) {
      this.logger.info(renderDryRunUpload(codeCoverageReport))

      return
    }

    try {
      this.logger.info(renderUpload(codeCoverageReport))
      await retryRequest(() => api.uploadCodeCoverageReport(codeCoverageReport), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(renderRetriedUpload(codeCoverageReport, e.message, attempt))
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(codeCoverageReport, error))
      if (error.response) {
        // If it's an axios error
        if (!errorCodesStopUpload.includes(error.response.status)) {
          // And a status code that should not stop the whole upload, just return
          return
        }
      }
      throw error
    }
  }
}
