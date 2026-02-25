import fs from 'fs'

import {newSimpleGit} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {uploadToGitDB} from '@datadog/datadog-ci-base/commands/git-metadata/gitdb'
import {isGitRepo} from '@datadog/datadog-ci-base/commands/git-metadata/library'
import {TerraformUploadCommand} from '@datadog/datadog-ci-base/commands/terraform/upload'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {getGitMetadata} from '@datadog/datadog-ci-base/helpers/git/format-git-span-data'
import id from '@datadog/datadog-ci-base/helpers/id'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {getUserGitSpanTags} from '@datadog/datadog-ci-base/helpers/user-provided-git'
import {getRequestBuilder, timedExecAsync} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import * as simpleGit from 'simple-git'

import {apiConstructor, apiUrl, intakeUrl} from '../api'
import {TerraformArtifactPayload} from '../interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderSuccessfulUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderSuccessfulGitDBSync,
  renderFailedGitDBSync,
} from '../renderer'
import {validateArtifactType, validateFilePath, validateJsonStructure, computeFileHash, resolveRepoId} from '../utils'

export class PluginCommand extends TerraformUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private git: simpleGit.SimpleGit | undefined = undefined

  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    // Validate artifact type
    if (!validateArtifactType(this.artifactType)) {
      this.context.stderr.write(`Invalid artifact type: ${this.artifactType}. Must be 'plan' or 'state'.\n`)

      return 1
    }

    // Validate API key
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )

      return 1
    }

    // Initialize git if in a repository
    const isGitRepository = await isGitRepo()
    if (isGitRepository) {
      this.git = await newSimpleGit()
    }

    // Sync git metadata if needed
    if (!this.skipGitMetadataUpload && isGitRepository) {
      await this.syncGitMetadata()
    }

    // Upload terraform artifact
    return this.uploadTerraformArtifact()
  }

  private async syncGitMetadata() {
    const traceId = id()
    const requestBuilder = getRequestBuilder({
      baseUrl: apiUrl,
      apiKey: this.config.apiKey!,
      headers: new Map([
        ['x-datadog-trace-id', traceId],
        ['x-datadog-parent-id', traceId],
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
  }

  private async uploadToGitDB(opts: {requestBuilder: any}) {
    if (!this.git) {
      return
    }

    await uploadToGitDB(this.logger, opts.requestBuilder, this.git, this.dryRun)
  }

  private async uploadTerraformArtifact(): Promise<number> {
    this.logger.info(renderCommandInfo(this.artifactType, this.filePath, this.dryRun))

    // Validate file exists and is readable
    if (!validateFilePath(this.filePath)) {
      this.context.stderr.write(renderInvalidFile(this.filePath, 'File not found or not readable'))

      return 1
    }

    // Read and validate JSON structure
    const fileContent = fs.readFileSync(this.filePath, 'utf8')
    if (!validateJsonStructure(fileContent)) {
      this.context.stderr.write(renderInvalidFile(this.filePath, 'Invalid JSON structure'))

      return 1
    }

    // Compute file hash and size
    const artifactSha256 = computeFileHash(fileContent)
    const artifactSizeBytes = Buffer.byteLength(fileContent, 'utf8')

    const spanTags = await this.getSpanTags()
    const api = apiConstructor(intakeUrl, this.config.apiKey!)

    // Build payload
    const payload: TerraformArtifactPayload = {
      artifactType: this.artifactType as 'plan' | 'state',
      filePath: this.filePath,
      fileContent,
      artifactSha256,
      artifactSizeBytes,
      spanTags,
      repoId: resolveRepoId(this.repoId, spanTags),
    }

    try {
      // Upload
      if (this.dryRun) {
        this.logger.info(renderDryRunUpload(payload))
      } else {
        await retryRequest(() => api.uploadTerraformArtifact(payload), {
          onRetry: (e, attempt) => {
            this.logger.warn(`Retry attempt ${attempt} for ${this.filePath}: ${e.message}`)
          },
          retries: 5,
        })
        this.logger.info(renderSuccessfulUpload(this.filePath))
      }

      return 0
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(this.filePath, error))

      return 1
    }
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
    }
  }
}
