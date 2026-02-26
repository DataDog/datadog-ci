import fs from 'fs'

import {newSimpleGit} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {uploadToGitDB} from '@datadog/datadog-ci-base/commands/git-metadata/gitdb'
import {isGitRepo} from '@datadog/datadog-ci-base/commands/git-metadata/library'
import {TerraformUploadCommand} from '@datadog/datadog-ci-base/commands/terraform/upload'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
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
import {validateFilePath, validateJsonStructure, computeFileHash, resolveRepoId} from '../utils'

export class PluginCommand extends TerraformUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private git: simpleGit.SimpleGit | undefined = undefined

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

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

    // Sync git metadata if needed (only once for all files)
    if (!this.skipGitMetadataUpload && isGitRepository) {
      await this.syncGitMetadata()
    }

    // Upload terraform artifacts
    let hasFailures = false
    for (const filePath of this.filePaths) {
      const exitCode = await this.uploadTerraformArtifact(filePath)
      if (exitCode !== 0) {
        hasFailures = true
      }
    }

    return hasFailures ? 1 : 0
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

  private async uploadTerraformArtifact(filePath: string): Promise<number> {
    this.logger.info(renderCommandInfo(this.artifactType, filePath, this.dryRun))

    // Validate file exists and is readable
    if (!validateFilePath(filePath)) {
      this.context.stderr.write(renderInvalidFile(filePath, 'File not found or not readable'))

      return 1
    }

    // Read and validate JSON structure
    const fileContent = fs.readFileSync(filePath, 'utf8')
    if (!validateJsonStructure(fileContent)) {
      this.context.stderr.write(renderInvalidFile(filePath, 'Invalid JSON structure'))

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
      filePath,
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
            this.logger.warn(`Retry attempt ${attempt} for ${filePath}: ${e.message}`)
          },
          retries: 5,
        })
        this.logger.info(renderSuccessfulUpload(filePath))
      }

      return 0
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(filePath, error))

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
