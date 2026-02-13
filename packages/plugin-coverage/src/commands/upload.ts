import os from 'os'

import {CoverageUploadCommand} from '@datadog/datadog-ci-base/commands/coverage/upload'
import {
  DiffData,
  getGitDiff,
  getGitFileHash,
  getMergeBase,
  newSimpleGit,
} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {uploadToGitDB} from '@datadog/datadog-ci-base/commands/git-metadata/gitdb'
import {isGitRepo} from '@datadog/datadog-ci-base/commands/git-metadata/library'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {partitionFiles} from '@datadog/datadog-ci-base/helpers/file-finder'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getGitMetadata} from '@datadog/datadog-ci-base/helpers/git/format-git-span-data'
import {parsePathsList} from '@datadog/datadog-ci-base/helpers/glob'
import id from '@datadog/datadog-ci-base/helpers/id'
import {RequestBuilder, SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH,
  GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from '@datadog/datadog-ci-base/helpers/tags'
import {getUserGitSpanTags} from '@datadog/datadog-ci-base/helpers/user-provided-git'
import {getRequestBuilder, timedExecAsync} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import * as simpleGit from 'simple-git'
import upath from 'upath'

import {apiConstructor, apiUrl, intakeUrl} from '../api'
import {APIHelper, Payload, RepoFile} from '../interfaces'
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
} from '../renderer'
import {coverageFormats, detectFormat, isCoverageFormat, toCoverageFormat, validateCoverageReport} from '../utils'

const TRACE_ID_HTTP_HEADER = 'x-datadog-trace-id'
const PARENT_ID_HTTP_HEADER = 'x-datadog-parent-id'
const errorCodesStopUpload = [400, 403]

const MAX_REPORTS_PER_REQUEST = 8 // backend supports 10 attachments, to keep the logic simple we subtract 2: for PR diff and commit diff

const COVERAGE_CONFIG_PATHS = ['code-coverage.datadog.yml', 'code-coverage.datadog.yaml']

const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']

export class PluginCommand extends CoverageUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private git: simpleGit.SimpleGit | undefined = undefined

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    if (!this.reportPaths.length) {
      this.context.stderr.write('Positional arguments must be provided\n')

      return 1
    }

    if (this.format && !isCoverageFormat(this.format)) {
      this.context.stderr.write(
        `Unsupported format: ${this.format}, supported values are [${coverageFormats.join(', ')}]\n`
      )

      return 1
    }

    const isGitRepository = await isGitRepo()

    if (isGitRepository) {
      this.git = await newSimpleGit()
    }

    if (!this.skipGitMetadataUpload) {
      if (isGitRepository) {
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

    await this.uploadCodeCoverageReports()
  }

  private async uploadToGitDB(opts: {requestBuilder: RequestBuilder}) {
    if (!this.git) {
      return
    }

    await uploadToGitDB(this.logger, opts.requestBuilder, this.git, this.dryRun, this.gitRepositoryURL)
  }

  private async uploadCodeCoverageReports() {
    // Normalizing the report paths to resolve .. and .
    this.reportPaths = this.reportPaths.map((reportPath) => upath.normalize(reportPath))

    this.logger.info(renderCommandInfo(this.reportPaths, this.dryRun))

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
    const flags = this.getFlags()

    const coverageConfig = await this.getRepoFile(COVERAGE_CONFIG_PATHS)
    const codeowners = await this.getRepoFile(CODEOWNERS_PATHS)
    const commitDiff = await this.getCommitDiff(spanTags)
    const prDiff = await this.getPrDiff(spanTags)
    const reports = this.getMatchingCoverageReportFilesByFormat()

    let payloads: Payload[] = []
    if (Object.keys(reports).length) {
      payloads = Object.entries(reports).flatMap(([format, paths]) => {
        const numChunks = Math.ceil(paths.length / MAX_REPORTS_PER_REQUEST)

        return Array.from({length: numChunks}, (_, i) => ({
          format,
          basePath: this.basePath,
          paths: paths.slice(i * MAX_REPORTS_PER_REQUEST, (i + 1) * MAX_REPORTS_PER_REQUEST),
          spanTags,
          flags,
          hostname: os.hostname(),
          commitDiff,
          prDiff,
          coverageConfig,
          codeowners,
        }))
      })
    }

    return payloads
  }

  private async getRepoFile(possiblePaths: string[]): Promise<RepoFile | undefined> {
    if (!this.git) {
      return undefined
    }

    for (const path of possiblePaths) {
      try {
        const sha = await getGitFileHash(this.git, path)
        if (sha) {
          return {path, sha}
        }
      } catch (e) {
        this.logger.debug(`Error while trying to get repo file ${path} details: ${e}`)
      }
    }

    return undefined
  }

  private async getPrDiff(spanTags: SpanTags): Promise<DiffData | undefined> {
    if (!this.uploadGitDiff || !this.git) {
      return undefined
    }

    try {
      const pr = await this.getHeadAndBase(spanTags)
      if (!pr.headSha || !pr.baseSha) {
        return undefined
      }

      return await getGitDiff(this.git, pr.baseSha, pr.headSha)
    } catch (e) {
      this.logger.debug(`Error while trying to calculate PR diff: ${e}`)

      return undefined
    }
  }

  private async getHeadAndBase(spanTags: SpanTags): Promise<{headSha?: string; baseSha?: string}> {
    const headSha = spanTags[GIT_HEAD_SHA] || spanTags[GIT_SHA]
    if (!headSha) {
      return {}
    }

    if (!this.git) {
      return {}
    }

    const baseSha = spanTags[GIT_PULL_REQUEST_BASE_BRANCH_SHA] || spanTags[GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA]
    if (baseSha) {
      // GitHub incorrectly reports base SHA as the head of the target branch
      // doing a merge-base allows us to get the real base SHA
      // (and if the base SHA was reported correctly, merge-base will not alter it)
      const mergeBase = await getMergeBase(this.git, baseSha, headSha)

      return {headSha, baseSha: mergeBase}
    }

    const baseBranch = spanTags[GIT_PULL_REQUEST_BASE_BRANCH]
    if (baseBranch) {
      const mergeBase = await getMergeBase(this.git, baseBranch, headSha)

      return {headSha, baseSha: mergeBase}
    }

    return {}
  }

  private async getCommitDiff(spanTags: SpanTags): Promise<DiffData | undefined> {
    if (!this.uploadGitDiff) {
      return undefined
    }

    const commit = spanTags[GIT_HEAD_SHA] || spanTags[GIT_SHA]
    if (!commit) {
      return undefined
    }

    if (!this.git) {
      return undefined
    }

    try {
      return await getGitDiff(this.git, commit + '^', commit)
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

  private getFlags(): string[] | undefined {
    if (!this.flags || this.flags.length === 0) {
      return undefined
    }

    if (this.flags.length > 32) {
      throw new Error(`Maximum of 32 flags per report allowed, but ${this.flags.length} flags were provided`)
    }

    return this.flags
  }

  private getMatchingCoverageReportFilesByFormat(): {[key: string]: string[]} {
    return partitionFiles(
      this.reportPaths || ['.'],
      parsePathsList(this.ignoredPaths),
      this.getCoverageReportFormat.bind(this)
    )
  }

  private getCoverageReportFormat(filePath: string, strict: boolean): string | undefined {
    const format = toCoverageFormat(this.format) || detectFormat(filePath, strict)
    if (!format) {
      if (strict) {
        this.context.stdout.write(renderInvalidFile(filePath, `format could not be detected`))
      }

      return undefined
    }

    const validationError = validateCoverageReport(filePath, format)
    if (validationError) {
      this.context.stdout.write(renderInvalidFile(filePath, validationError))

      return undefined
    }

    return format
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
