import chalk from 'chalk'
import {Command} from 'clipanion'
import asyncPool from 'tiny-async-pool'

import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import {InvalidConfigurationError} from '../../helpers/errors'
import {getRepositoryData, newSimpleGit, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {upload, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'
import {RNPlatform, RNSourcemap, RN_SUPPORTED_PLATFORMS} from './interfaces'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedUpload,
  renderGitDataNotAttachedWarning,
  renderGitWarning,
  renderRetriedUpload,
  renderSourcesNotFoundWarning,
  renderSuccessfulCommand,
  renderUpload,
} from './renderer'
import {InvalidPayload, validatePayload} from './validation'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload React Native sourcemaps to Datadog.',
    details: `
            This command will upload React Native sourcemaps and their corresponding javascript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.
            See README for details.
        `,
    examples: [
      [
        'Upload ios sourcemaps',
        'datadog-ci react-native upload --platform ios --service com.company.app --bundle ./main.jsbundle --sourcemap ./main.jsbundle.map --release-version 1.23.4 --build-version 1234',
      ],
      [
        'Upload android sourcemaps',
        'datadog-ci react-native upload --platform android --service com.company.app --bundle ./index.android.bundle --sourcemap ./index.android.bundle.map --release-version 1.23.4 --build-version 1234',
      ],
    ],
  })

  private buildVersion?: string
  private bundle?: string
  private cliVersion: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private disableGit?: boolean
  private dryRun = false
  private maxConcurrency = 20
  private platform?: RNPlatform
  private projectPath: string = process.cwd() || ''
  private releaseVersion?: string
  private repositoryURL?: string
  private service?: string
  private sourcemap?: string

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
  }

  public async execute() {
    if (!this.releaseVersion) {
      this.context.stderr.write('Missing release version\n')

      return 1
    }

    if (!this.buildVersion) {
      this.context.stderr.write('Missing build version\n')

      return 1
    }

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    if (!this.bundle) {
      this.context.stderr.write('Missing bundle path\n')

      return 1
    }

    if (!this.platform) {
      this.context.stderr.write('Missing platform\n')

      return 1
    }

    if (!RN_SUPPORTED_PLATFORMS.includes(this.platform)) {
      this.context.stderr.write(
        `Platform ${this.platform} is not supported.\nSupported platforms are ios and android.\n`
      )

      return 1
    }

    if (!this.sourcemap) {
      this.context.stderr.write('Missing sourcemap file path\n')

      return 1
    }

    this.context.stdout.write(
      renderCommandInfo(
        this.bundle,
        this.sourcemap,
        this.platform,
        this.releaseVersion,
        this.service,
        this.maxConcurrency,
        this.dryRun,
        this.projectPath,
        this.buildVersion
      )
    )
    const metricsLogger = getMetricsLogger({
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [
        `version:${this.releaseVersion}`,
        `build:${this.buildVersion}`,
        `service:${this.service}`,
        `cli_version:${this.cliVersion}`,
        'react-native:true',
        `platform:${this.platform}`,
      ],
      prefix: 'datadog.ci.sourcemaps.upload.',
    })
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
    const useGit = this.disableGit === undefined || !this.disableGit
    const initialTime = Date.now()
    const payloads = await this.getPayloadsToUpload(useGit)
    const requestBuilder = this.getRequestBuilder()
    const uploadMultipart = this.upload(requestBuilder, metricsLogger, apiKeyValidator)
    try {
      const results = await asyncPool(this.maxConcurrency, payloads, uploadMultipart)
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
  private addRepositoryDataToPayloads = async (payloads: RNSourcemap[]) => {
    try {
      const repositoryData = await getRepositoryData(await newSimpleGit(), this.repositoryURL)
      payloads.forEach((payload) => {
        const repositoryPayload = this.getRepositoryPayload(repositoryData!, payload.sourcemapPath)
        payload.addRepositoryData({
          gitCommitSha: repositoryData.hash,
          gitRepositoryPayload: repositoryPayload,
          gitRepositoryURL: repositoryData.remote,
        })
      })
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }
  }

  // Looks for the sourcemaps and minified files on disk and returns
  // the associated payloads.
  private getMatchingRNSourcemapFiles = (): RNSourcemap[] => [new RNSourcemap(this.bundle!, this.sourcemap!)]

  private getPayloadsToUpload = async (useGit: boolean): Promise<RNSourcemap[]> => {
    const payloads = this.getMatchingRNSourcemapFiles()
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
    const onSourcesNotFound = () => {
      this.context.stdout.write(renderSourcesNotFoundWarning(sourcemapPath))
    }
    let repositoryPayload: string | undefined
    try {
      const files = repositoryData.trackedFilesMatcher.matchSourcemap(sourcemapPath, onSourcesNotFound)
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

  private getRequestBuilder(): RequestBuilder {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return getRequestBuilder({
      apiKey: this.config.apiKey!,
      baseUrl: getBaseSourcemapIntakeUrl(),
      headers: new Map([
        ['DD-EVP-ORIGIN', 'datadog-ci react-native'],
        ['DD-EVP-ORIGIN-VERSION', this.cliVersion],
      ]),
      overrideUrl: `v1/input/${this.config.apiKey}`,
    })
  }

  private upload(
    requestBuilder: RequestBuilder,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): (sourcemap: RNSourcemap) => Promise<UploadStatus> {
    return async (sourcemap: RNSourcemap) => {
      try {
        validatePayload(sourcemap)
      } catch (error) {
        if (error instanceof InvalidPayload) {
          this.context.stdout.write(renderFailedUpload(sourcemap, error.message))
          metricsLogger.logger.increment('skipped_sourcemap', 1, [`reason:${error.reason}`])
        } else {
          this.context.stdout.write(
            renderFailedUpload(
              sourcemap,
              `Skipping sourcemap ${sourcemap.sourcemapPath} because of error: ${error.message}`
            )
          )
          metricsLogger.logger.increment('skipped_sourcemap', 1, ['reason:unknown'])
        }

        return UploadStatus.Skipped
      }

      const payload = sourcemap.asMultipartPayload(
        this.cliVersion,
        this.service!,
        this.releaseVersion!,
        this.projectPath,
        this.platform!,
        this.buildVersion!
      )
      if (this.dryRun) {
        this.context.stdout.write(`[DRYRUN] ${renderUpload(sourcemap)}`)

        return UploadStatus.Success
      }

      return upload(requestBuilder)(payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(sourcemap, e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempts) => {
          this.context.stdout.write(renderRetriedUpload(sourcemap, e.message, attempts))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          this.context.stdout.write(renderUpload(sourcemap))
        },
        retries: 5,
      })
    }
  }
}

UploadCommand.addPath('react-native', 'upload')
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('buildVersion', Command.String('--build-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('bundle', Command.String('--bundle'))
UploadCommand.addOption('sourcemap', Command.String('--sourcemap'))
UploadCommand.addOption('platform', Command.String('--platform'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
