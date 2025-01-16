import fs from 'fs'
import os from 'os'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import glob from 'glob'
import * as t from 'typanion'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import id from '../../helpers/id'
import {RequestBuilder, SpanTags} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import {GIT_REPOSITORY_URL, GIT_SHA, parseMetrics, parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath, getRequestBuilder, timedExecAsync} from '../../helpers/utils'

import {isGitRepo} from '../git-metadata'
import {newSimpleGit} from '../git-metadata/git'
import {uploadToGitDB} from '../git-metadata/gitdb'

import {apiConstructor, apiUrl, intakeUrl} from './api'
import {APIHelper, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedGitDBSync,
  renderFailedUpload,
  renderInvalidFile,
  renderRetriedUpload,
  renderSuccessfulGitDBSync,
  renderSuccessfulUpload,
  renderSuccessfulUploadCommand,
  renderUpload,
} from './renderer'
import {detectFormat, isFile, validateCoverageReport} from './utils'

const TRACE_ID_HTTP_HEADER = 'x-datadog-trace-id'
const PARENT_ID_HTTP_HEADER = 'x-datadog-parent-id'
const errorCodesStopUpload = [400, 403]

const MAX_REPORTS_PER_REQUEST = 10

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
      ['Upload all code coverage report files in current directory', 'datadog-ci coverage upload .'],
      ['Send code coverage upload completed signal', 'datadog-ci coverage upload --flush'],
      [
        'Upload all code coverage report files in current directory and send code coverage upload completed signal',
        'datadog-ci coverage upload --flush .',
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
  private flush = Option.Boolean('--flush')
  private verbose = Option.Boolean('--verbose', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private measures = Option.Array('--measures')
  private tags = Option.Array('--tags')
  private format = Option.String('--format')
  private skipGitMetadataUpload = Option.String('--skip-git-metadata-upload', 'false', {
    validator: t.isBoolean(),
    tolerateBoolean: true,
  })

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMeasures: process.env.DD_MEASURES,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    if (this.flush === undefined && !this.basePaths.length) {
      this.context.stderr.write('Either positional arguments or --flush must be provided\n')

      return 1
    }

    await this.uploadCodeCoverageReports()

    if (!this.skipGitMetadataUpload) {
      await this.uploadGitMetadata()
    } else {
      this.logger.debug('Not syncing git metadata (skip git upload flag detected)')
    }

    if (!this.dryRun) {
      this.context.stdout.write(renderSuccessfulUploadCommand(this.basePaths, this.flush))
    }
  }

  private async uploadCodeCoverageReports() {
    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))

    this.logger.info(renderCommandInfo(this.basePaths, this.flush, this.dryRun))

    const api = this.getApiHelper()
    const payloads = await this.generatePayloads()

    let fileCount = 0
    let flushed = false

    const initialTime = new Date().getTime()
    for (const payload of payloads) {
      fileCount += payload.paths.length
      flushed = flushed || payload.flush
      await this.uploadCodeCoverageReport(api, payload)
    }
    const totalTimeSeconds = (Date.now() - initialTime) / 1000

    this.logger.info(renderSuccessfulUpload(this.dryRun, fileCount, flushed, totalTimeSeconds))
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

  private async generatePayloads(): Promise<Payload[]> {
    const spanTags = await this.getSpanTags()
    const customTags = this.getCustomTags()
    const customMeasures = this.getCustomMeasures()

    const reports = this.getMatchingCoverageReportFilesByFormat()

    let payloads: Payload[] = []
    if (Object.keys(reports).length) {
      payloads = Object.entries(reports).flatMap(([format, paths]) => {
        const numChunks = Math.ceil(paths.length / MAX_REPORTS_PER_REQUEST)

        return Array.from({length: numChunks}, (_, i) => ({
          format,
          paths: paths.slice(i * MAX_REPORTS_PER_REQUEST, (i + 1) * MAX_REPORTS_PER_REQUEST),
          flush: false,
          spanTags,
          customTags,
          customMeasures,
          hostname: os.hostname(),
        }))
      })

      // to set the last payload to flush
      payloads[payloads.length - 1].flush = !!this.flush
    } else if (this.flush) {
      // no reports to upload, only send the flush signal
      payloads.push({
        format: undefined,
        paths: [],
        flush: true,
        spanTags,
        customTags,
        customMeasures,
        hostname: os.hostname(),
      })
    }

    return payloads
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
    const codeCoverageReportFiles = this.basePaths
      .reduce((acc: string[], basePath: string) => {
        if (isFile(basePath)) {
          return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
        }
        let globPattern
        // It's either a folder or a glob pattern
        if (glob.hasMagic(basePath)) {
          // It's a glob pattern so we just use it as is
          globPattern = basePath
        } else {
          // It's a folder
          globPattern = buildPath(basePath, '*.xml')
        }

        const filesToUpload = glob.sync(globPattern).filter((file) => path.extname(file) === '.xml')

        return acc.concat(filesToUpload)
      }, [])
      .filter(isFile)

    const uniqueFiles = [...new Set(codeCoverageReportFiles)]
    const pathsByFormat: {[key: string]: string[]} = {}

    for (const codeCoverageReportPath of uniqueFiles) {
      const format = this.format || detectFormat(codeCoverageReportPath)
      if (format === undefined) {
        this.context.stdout.write(
          renderInvalidFile(
            codeCoverageReportPath,
            `Could not detect format of ${codeCoverageReportPath}, please specify the format manually using the --format option`
          )
        )
        continue
      }

      const validationErrorMessage = validateCoverageReport(codeCoverageReportPath, format)
      if (validationErrorMessage) {
        this.context.stdout.write(renderInvalidFile(codeCoverageReportPath, validationErrorMessage))
      } else {
        const paths = pathsByFormat[format]
        if (!paths) {
          pathsByFormat[format] = [codeCoverageReportPath]
        } else {
          pathsByFormat[format].push(codeCoverageReportPath)
        }
      }
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

  private async uploadToGitDB(opts: {requestBuilder: RequestBuilder}) {
    await uploadToGitDB(this.logger, opts.requestBuilder, await newSimpleGit(), this.dryRun)
  }

  private async uploadGitMetadata() {
    if (await isGitRepo()) {
      const traceId = id()

      const requestBuilder = getRequestBuilder({
        baseUrl: apiUrl,
        apiKey: this.config.apiKey!,
        headers: new Map([
          [TRACE_ID_HTTP_HEADER, traceId],
          [PARENT_ID_HTTP_HEADER, traceId],
        ]),
      })
      try {
        this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Syncing git metadata...`)
        let elapsed = 0
        if (!this.dryRun) {
          elapsed = await timedExecAsync(this.uploadToGitDB.bind(this), {requestBuilder})
        }
        this.logger.info(renderSuccessfulGitDBSync(this.dryRun, elapsed))
      } catch (err) {
        this.logger.info(renderFailedGitDBSync(err))
      }
    } else {
      this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Not syncing git metadata (not a git repo)`)
    }
  }
}
