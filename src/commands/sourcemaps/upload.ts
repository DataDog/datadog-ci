import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import glob from 'glob'
import path from 'path'
import asyncPool from 'tiny-async-pool'
import {URL} from 'url'

import {ApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {UploadStatus} from '../../helpers/upload'
import {apiConstructor, APIHelper, uploadWithRetry} from '../../helpers/upload'
import {getRepositoryData, newSimpleGit, RepositoryData} from './git'
import {Sourcemap} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedUpload,
  renderGitDataNotAttachedWarning,
  renderInvalidPrefix,
  renderSuccessfulCommand,
} from './renderer'
import {getBaseIntakeUrl, getMinifiedFilePath} from './utils'
import {InvalidPayload, validatePayload} from './validation'

import {buildPath} from '../../helpers/utils'

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
  private cliVersion: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private disableGit?: boolean
  private dryRun = false
  private maxConcurrency = 20
  private minifiedPathPrefix?: string
  private projectPath = ''
  private releaseVersion?: string
  private repositoryURL?: string
  private service?: string

  constructor() {
    super()
    this.apiKeyValidator = new ApiKeyValidator(this.config.apiKey, this.config.datadogSite)
    this.cliVersion = require('../../../package.json').version
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
    const metricsLogger = getMetricsLogger(this.releaseVersion, this.service, this.cliVersion)
    const useGit = this.disableGit === undefined || !this.disableGit
    const initialTime = Date.now()
    const payloads = await this.getPayloadsToUpload(useGit)
    const upload = (p: Sourcemap) => this.uploadSourcemap(api, metricsLogger.logger, p)
    try {
      const results = await asyncPool(this.maxConcurrency, payloads, upload)
      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderSuccessfulCommand(results, totalTime, this.dryRun))
      metricsLogger.logger.gauge('duration', totalTime)

      return 0
    } catch (error) {
      if (error instanceof InvalidConfigurationError) {
        this.context.stdout.write(renderConfigurationError(error))

        return 1
      }
      // Otherwise unknown error, let's propagate the exception
      throw error
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  // Fills the 'repository' field of each payload with data gathered using git.
  private addRepositoryDataToPayloads = async (payloads: Sourcemap[]) => {
    const repositoryData = await getRepositoryData(await newSimpleGit(), this.context.stdout, this.repositoryURL)
    if (repositoryData === undefined) {
      return
    }
    await Promise.all(
      payloads.map(async (payload) => {
        const repositoryPayload = this.getRepositoryPayload(repositoryData!, payload.sourcemapPath)
        payload.addRepositoryData({
          gitCommitSha: repositoryData.hash,
          gitRepositoryPayload: repositoryPayload,
          gitRepositoryURL: repositoryData.remote,
        })
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
  private getMatchingSourcemapFiles = async (): Promise<Sourcemap[]> => {
    const sourcemapFiles = glob.sync(buildPath(this.basePath!, '**/*js.map'))

    return Promise.all(
      sourcemapFiles.map(async (sourcemapPath) => {
        const minifiedFilePath = getMinifiedFilePath(sourcemapPath)
        const minifiedURL = this.getMinifiedURL(minifiedFilePath)

        return new Sourcemap(minifiedFilePath, minifiedURL, sourcemapPath)
      })
    )
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath!, '')

    return buildPath(this.minifiedPathPrefix!, relativePath)
  }

  private getPayloadsToUpload = async (useGit: boolean): Promise<Sourcemap[]> => {
    const payloads = await this.getMatchingSourcemapFiles()
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
    try {
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
    } catch (error) {
      this.context.stdout.write(renderGitDataNotAttachedWarning(sourcemapPath, error.message))

      return undefined
    }
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
    sourcemap: Sourcemap
  ): Promise<UploadStatus> {
    try {
      validatePayload(sourcemap)
    } catch (error) {
      if (error instanceof InvalidPayload) {
        this.context.stdout.write(renderFailedUpload(sourcemap, error.message))
        metricsLogger.increment('skipped_sourcemap', 1, [`reason:${error.reason}`])
      } else {
        this.context.stdout.write(
          renderFailedUpload(
            sourcemap,
            `Skipping sourcemap ${sourcemap.sourcemapPath} because of error: ${error.message}`
          )
        )
        metricsLogger.increment('skipped_sourcemap', 1, ['reason:unknown'])
      }

      return UploadStatus.Skipped
    }

    const payload = sourcemap.asMultipartPayload(
      this.cliVersion, this.service!, this.releaseVersion!, this.projectPath
    )
    if (this.dryRun) {
      this.context.stdout.write(`[DRYRUN] ${payload.renderUpload()}`)

      return UploadStatus.Success
    }

    return uploadWithRetry(payload, {
      api,
      apiKeyValidator: this.apiKeyValidator,
      datadogSite: this.config.datadogSite,
      logger: this.context.stdout.write.bind(this.context.stdout),
      metricsLogger,
      retries: 5,
    })
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
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
