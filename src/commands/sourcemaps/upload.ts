import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import fs from 'fs'
import glob from 'glob'
import path from 'path'
import asyncPool from 'tiny-async-pool'
import {URL} from 'url'

import {apiConstructor} from './api'
import {ApiKeyValidator} from './apikey'
import {InvalidConfigurationError} from './errors'
import {getRepositoryData, newSimpleGit, RepositoryData} from './git'
import {APIHelper, Payload, UploadStatus} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderDryRunUpload,
  renderFailedUpload,
  renderInvalidPrefix,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {buildPath, getBaseIntakeUrl, getMinifiedFilePath} from './utils'

const errorCodesNoRetry = [400, 403, 413]

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload javascript sourcemaps to Datadog.',
    details: `
            This command will upload all javascript sourcemaps and their corresponding javascript file to Datadog in order to un-minify front-end stack traces received by Datadog.
            See README for details.
        `,
    examples: [
      [
        'Upload all sourcemaps in current directory',
        'datadog-ci sourcemaps upload . --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234',
      ],
      [
        'Upload all sourcemaps in /home/users/ci with 50 concurrent uploads',
        'datadog-ci sourcemaps upload . --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234 --concurency 50',
      ],
    ],
  })

  private apiKeyValidator: ApiKeyValidator
  private basePath?: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private dryRun = false
  private enableGit?: boolean
  private maxConcurrency = 20
  private minifiedPathPrefix?: string
  private projectPath = ''
  private releaseVersion?: string
  private repositoryURL?: string
  private service?: string

  constructor() {
    super()
    this.apiKeyValidator = new ApiKeyValidator(this.config.apiKey, this.config.datadogSite)
  }

  public async execute() {
    if (!this.releaseVersion) {
      this.context.stderr.write('Missing release version\n')

      return 1
    }

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    if (!this.minifiedPathPrefix) {
      this.context.stderr.write('Missing minified path\n')

      return 1
    }

    if (!this.isMinifiedPathPrefixValid()) {
      this.context.stdout.write(renderInvalidPrefix)

      return 1
    }

    const api = this.getApiHelper()
    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePath = path.posix.normalize(this.basePath!)
    this.context.stdout.write(
      renderCommandInfo(
        this.basePath!,
        this.minifiedPathPrefix,
        this.projectPath,
        this.releaseVersion,
        this.service,
        this.maxConcurrency,
        this.dryRun
      )
    )
    const cliVersion = require('../../../package.json').version
    const metricsLogger = getMetricsLogger(this.releaseVersion, this.service, cliVersion)
    const useGit = this.enableGit !== undefined && this.enableGit
    const initialTime = Date.now()
    const payloads = await this.getPayloadsToUpload(useGit, cliVersion)
    const upload = (p: Payload) => this.uploadSourcemap(api, metricsLogger, p)
    try {
      const results = await asyncPool(this.maxConcurrency, payloads, upload)
      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderSuccessfulCommand(results, totalTime, this.dryRun))
      metricsLogger.gauge('duration', totalTime)
      metricsLogger.flush()

      return 0
    } catch (error) {
      if (error instanceof InvalidConfigurationError) {
        this.context.stdout.write(renderConfigurationError(error))

        return 1
      }
      // Otherwise unknown error, let's propagate the exception
      throw error
    }
  }

  // Fills the 'repository' field of each payload with data gathered using git.
  private addRepositoryDataToPayloads = async (payloads: Payload[]) => {
    const repositoryData = await getRepositoryData(await newSimpleGit(), this.context.stdout, this.repositoryURL)
    if (repositoryData === undefined) {
      return
    }
    await Promise.all(
      payloads.map(async (payload) => {
        payload.gitRepositoryPayload = this.getRepositoryPayload(repositoryData, payload.sourcemapPath)
        payload.gitRepositoryURL = repositoryData.remote
        payload.gitCommitSha = repositoryData.hash
      })
    )
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey!)
  }

  // Looks for the sourcemaps and minified files on disk and returns
  // the associated payloads.
  private getMatchingSourcemapFiles = async (cliVersion: string): Promise<Payload[]> => {
    const sourcemapFiles = glob.sync(buildPath(this.basePath!, '**/*js.map'))

    return Promise.all(
      sourcemapFiles.map(async (sourcemapPath) => {
        const minifiedFilePath = getMinifiedFilePath(sourcemapPath)
        const minifiedURL = this.getMinifiedURL(minifiedFilePath)

        return {
          cliVersion,
          minifiedFilePath,
          minifiedUrl: minifiedURL,
          projectPath: this.projectPath,
          service: this.service!,
          sourcemapPath,
          version: this.releaseVersion!,
        }
      })
    )
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath!, '')

    return buildPath(this.minifiedPathPrefix!, relativePath)
  }

  private getPayloadsToUpload = async (useGit: boolean, cliVersion: string): Promise<Payload[]> => {
    const payloads = await this.getMatchingSourcemapFiles(cliVersion)
    if (!useGit) {
      return payloads
    }

    await this.addRepositoryDataToPayloads(payloads)

    return payloads
  }

  // GetRepositoryPayload generates the repository payload for a specific sourcemap.
  // It specifically looks for the list of tracked files that are associated to the source paths
  // declared inside the sourcemap.
  private getRepositoryPayload = (repositoryData: RepositoryData, sourcemapPath: string): string | undefined => {
    let repositoryPayload: string | undefined
    const files = repositoryData.trackedFilesMatcher.matchSourcemap(this.context.stdout, sourcemapPath)
    if (files) {
      repositoryPayload = JSON.stringify({
        data: [
          {
            files,
            hash: repositoryData.hash,
            repository_url: repositoryData.remote,
          },
        ],
        // Make sure to update the version if the format of the JSON payloads changes in any way.
        version: 1,
      })
    }

    return repositoryPayload
  }

  private isMinifiedPathPrefixValid(): boolean {
    let protocol
    try {
      const objUrl = new URL(this.minifiedPathPrefix!)
      protocol = objUrl.protocol
    } catch {
      // Do nothing.
    }

    if (!protocol && !this.minifiedPathPrefix!.startsWith('/')) {
      return false
    }

    return true
  }

  private async uploadSourcemap(
    api: APIHelper,
    metricsLogger: BufferedMetricsLogger,
    sourcemap: Payload
  ): Promise<UploadStatus> {
    try {
      const statSourcemap = fs.statSync(sourcemap.sourcemapPath)
      if (statSourcemap.size === 0) {
        this.context.stdout.write(
          renderFailedUpload(sourcemap, `Skipping empty sourcemap (${sourcemap.sourcemapPath})`)
        )
        metricsLogger.increment('skipped_empty_sourcemap', 1)

        return UploadStatus.Skipped
      }
    } catch (error) {
      // File does not exist, not supposed to happen
    }
    try {
      const statMinifiedFile = fs.statSync(sourcemap.minifiedFilePath)
      if (statMinifiedFile.size === 0) {
        this.context.stdout.write(
          renderFailedUpload(sourcemap, `Skipping sourcemap (${sourcemap.sourcemapPath}) due to ${sourcemap.minifiedFilePath} being empty`)
        )
        metricsLogger.increment('skipped_empty_js', 1)

        return UploadStatus.Skipped
      }
    } catch (error) {
      // Should we be more specific and check the exact error type? Will this work on windows?
      this.context.stdout.write(
        renderFailedUpload(sourcemap, `Missing corresponding JS file for sourcemap (${sourcemap.minifiedFilePath})`)
      )
      metricsLogger.increment('skipped_missing_js', 1)

      return UploadStatus.Skipped
    }

    try {
      return await retry(
        async (bail) => {
          try {
            if (this.dryRun) {
              this.context.stdout.write(renderDryRunUpload(sourcemap))

              return UploadStatus.Success
            }
            await api.uploadSourcemap(sourcemap, this.context.stdout.write.bind(this.context.stdout))
            metricsLogger.increment('success', 1)

            return UploadStatus.Success
          } catch (error) {
            if (error.response) {
              // If it's an axios error
              if (!errorCodesNoRetry.includes(error.response.status)) {
                // And a status code that is not excluded from retries, throw the error so that upload is retried
                throw error
              }
            }
            // If it's another error or an axios error we don't want to retry, bail
            bail(error)

            return UploadStatus.Failure
          }
        },
        {
          onRetry: (e, attempt) => {
            metricsLogger.increment('retries', 1)
            this.context.stdout.write(renderRetriedUpload(sourcemap, e.message, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      let invalidApiKey: boolean = error.response && error.response.status === 403
      if (error.response && error.response.status === 400) {
        invalidApiKey = !(await this.apiKeyValidator.isApiKeyValid())
      }
      if (invalidApiKey) {
        metricsLogger.increment('invalid_auth', 1)
        throw new InvalidConfigurationError(
          `${chalk.red.bold('DATADOG_API_KEY')} does not contain a valid API key for Datadog site ${
            this.config.datadogSite
          }`
        )
      }
      metricsLogger.increment('failed', 1)
      this.context.stdout.write(renderFailedUpload(sourcemap, error))

      return UploadStatus.Failure
    }
  }
}

UploadCommand.addPath('sourcemaps', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('minifiedPathPrefix', Command.String('--minified-path-prefix'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
UploadCommand.addOption('enableGit', Command.Boolean('--enable-git-experimental'))
