import fs from 'fs'
import os from 'os'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import glob from 'glob'
import * as t from 'typanion'

import {getCISpanTags} from '../../helpers/ci'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {RequestBuilder, SpanTags} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import {GIT_REPOSITORY_URL, GIT_SHA, parseMetrics, parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath, getRequestBuilder, timedExecAsync} from '../../helpers/utils'
import * as validation from '../../helpers/validation'

import {isGitRepo} from '../git-metadata'
import {newSimpleGit} from '../git-metadata/git'
import {uploadToGitDB} from '../git-metadata/gitdb'

import {apiConstructor, apiUrl, intakeUrl} from './api'
import id from './id'
import {APIHelper, Flush, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedFlush,
  renderFailedGitDBSync,
  renderFailedUpload,
  renderFlushInfo,
  renderInvalidFile,
  renderRetriedFlush,
  renderRetriedUpload,
  renderSuccessfulUploadCommand,
  renderSuccessfulFlush,
  renderSuccessfulGitDBSync,
  renderSuccessfulUpload,
  renderUpload,
  renderSuccessfulFlushCommand,
} from './renderer'
import { detectFormat, isFile, validateCoverageReport } from "./utils";

const TRACE_ID_HTTP_HEADER = 'x-datadog-trace-id'
const PARENT_ID_HTTP_HEADER = 'x-datadog-parent-id'
const errorCodesStopUpload = [400, 403]

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
      ['Upload all code coverage report files in current directory', 'datadog-ci coverage upload --path .'],
      ['Send code coverage upload completed signal', 'datadog-ci coverage upload --flush'],
      [
        'Upload all code coverage report files in src/unit-test-coverage and src/acceptance-test-coverage',
        'datadog-ci coverage upload --path src/unit-test-coverage --path src/acceptance-test-coverage',
      ],
      [
        'Upload all code coverage report files in current directory and add extra tags globally',
        'datadog-ci coverage upload --tags key1:value1 --tags key2:value2 --path .',
      ],
      [
        'Upload all code coverage report files in current directory and add extra measures globally',
        'datadog-ci coverage upload --measures key1:123 --measures key2:321 .',
      ],
      [
        'Upload all code coverage report files in current directory to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci coverage upload --path .',
      ],
      [
        'Upload all code coverage report files in current directory with extra verbosity',
        'datadog-ci coverage upload --verbose --path .',
      ],
    ],
  })

  private basePaths = Option.Array('--path')
  private flush = Option.Boolean('--flush')
  private verbose = Option.Boolean('--verbose', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private measures = Option.Array('--measures')
  private tags = Option.Array('--tags')
  private format = Option.String('--format')
  private gitRepositoryURL = Option.String('--git-repository-url')
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

    if (this.flush === undefined && this.basePaths === undefined) {
      this.context.stderr.write('Either --path or --flush must be provided\n')

      return 1
    }

    const api = this.getApiHelper()

    const spanTags = await this.getSpanTags()
    const customTags = this.getCustomTags()
    const customMeasures = this.getCustomMeasures()

    if (this.basePaths) {
      // Normalizing the basePath to resolve .. and .
      // Always using the posix version to avoid \ on Windows.
      this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
      this.logger.info(renderCommandInfo(this.basePaths, this.maxConcurrency, this.dryRun))

      const payloads = await this.getMatchingCoverageReportFiles(spanTags, customTags, customMeasures)
      const upload = (p: Payload) => this.uploadCodeCoverageReport(api, p)

      const initialTime = new Date().getTime()

      await doWithMaxConcurrency(this.maxConcurrency, payloads, upload)

      const totalTimeSeconds = (Date.now() - initialTime) / 1000
      this.logger.info(renderSuccessfulUpload(this.dryRun, payloads.length, totalTimeSeconds))
    }

    if (this.flush) {
      this.logger.info(renderFlushInfo(this.dryRun))
      const flushSignal: Flush = {
        hostname: os.hostname(),
        spanTags,
        customTags,
        customMeasures,
      }
      const initialTime = new Date().getTime()
      await this.sendFlush(api, flushSignal)
      const totalTimeSeconds = (Date.now() - initialTime) / 1000
      this.logger.info(renderSuccessfulFlush(this.dryRun, totalTimeSeconds))
    }

    if (!this.skipGitMetadataUpload) {
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
    } else {
      this.logger.debug('Not syncing git metadata (skip git upload flag detected)')
    }

    if (!this.dryRun) {
      if (this.basePaths) {
        this.context.stdout.write(renderSuccessfulUploadCommand())
      } else {
        this.context.stdout.write(renderSuccessfulFlushCommand())
      }
    }
  }

  private async uploadToGitDB(opts: {requestBuilder: RequestBuilder}) {
    await uploadToGitDB(this.logger, opts.requestBuilder, await newSimpleGit(), this.dryRun, this.gitRepositoryURL)
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

  private async getMatchingCoverageReportFiles(
    spanTags: SpanTags,
    customTags: Record<string, string>,
    customMeasures: Record<string, number>
  ): Promise<Payload[]> {
    const codeCoverageReportFiles = (this.basePaths || [])
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
          globPattern = buildPath(basePath, '*.xml') // TODO update the logic to not assume that every report has .xml extension
        }

        const filesToUpload = glob.sync(globPattern).filter((file) => path.extname(file) === '.xml')

        return acc.concat(filesToUpload)
      }, [])
      .filter(isFile)

    const uniqueFiles = [...new Set(codeCoverageReportFiles)]
    const payloads: Payload[] = []

    for (const codeCoverageReportPath of uniqueFiles) {
      const format: string | undefined = (await detectFormat(codeCoverageReportPath)) || this.format
      const validationErrorMessage = await validateCoverageReport(codeCoverageReportPath, format, this.format)
      if (validationErrorMessage) {
        this.context.stdout.write(renderInvalidFile(codeCoverageReportPath, validationErrorMessage))
      } else {
        payloads.push({
          hostname: os.hostname(),
          spanTags,
          customTags,
          customMeasures,
          path: codeCoverageReportPath,
          format: format as string,
        })
      }
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

  private async sendFlush(api: APIHelper, flushSignal: Flush) {
    if (this.dryRun) {
      return
    }

    try {
      await retryRequest(() => api.flushCodeCoverage(flushSignal), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(renderRetriedFlush(e.message, attempt))
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(renderFailedFlush(error))
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
