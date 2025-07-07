import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {toBoolean} from '../../helpers/env'
import {InvalidConfigurationError} from '../../helpers/errors'
import {enableFips} from '../../helpers/fips'
import {getRepositoryData, newSimpleGit, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {upload, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import {RNPlatform, RNSourcemap, RN_SUPPORTED_PLATFORMS} from './interfaces'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedSourcesContentRemovalError,
  renderFailedUpload,
  renderGitDataNotAttachedWarning,
  renderGitWarning,
  renderRemoveSourcesContentWarning,
  renderRetriedUpload,
  renderSourcesNotFoundWarning,
  renderSuccessfulCommand,
  renderUpload,
} from './renderer'
import {getBundleName} from './utils'
import {InvalidPayload, validatePayload} from './validation'

export class UploadCommand extends Command {
  public static paths = [['react-native', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload React Native sourcemaps to Datadog.',
    details: `
      This command will upload React Native sourcemaps and their corresponding JavaScript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.\n
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

  private buildVersion = Option.String('--build-version')
  private bundle = Option.String('--bundle')
  private configPath = Option.String('--config')
  private disableGit = Option.Boolean('--disable-git')
  private dryRun = Option.Boolean('--dry-run', false)
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private platform?: RNPlatform = Option.String('--platform')
  private projectPath = Option.String('--project-path', process.cwd() || '')
  private releaseVersion = Option.String('--release-version')
  private removeSourcesContent = Option.Boolean('--remove-sources-content', false)
  private repositoryURL = Option.String('--repository-url')
  private service = Option.String('--service')
  private sourcemap = Option.String('--sourcemap')

  private cliVersion = version
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

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

    const bundleName = getBundleName(this.bundle, this.platform)

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
        this.buildVersion,
        bundleName
      )
    )

    this.config = await resolveConfigFromFileAndEnvironment(
      this.config,
      {
        apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
        datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
      },
      {
        configPath: this.configPath,
        defaultConfigPaths: ['datadog-ci.json', '../datadog-ci.json'],
        configFromFileCallback: (configFromFile: any) => {
          checkAPIKeyOverride(
            process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
            configFromFile.apiKey,
            this.context.stdout,
          )
        },
      }
    )

    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
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
    const payloads = await this.getPayloadsToUpload(useGit, bundleName)
    const requestBuilder = this.getRequestBuilder()
    const uploadMultipart = this.upload(requestBuilder, metricsLogger, apiKeyValidator)
    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, payloads, uploadMultipart)
      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderSuccessfulCommand(results, totalTime, this.dryRun))
      metricsLogger.logger.gauge('duration', totalTime)

      return results.some((result) => result !== UploadStatus.Success) ? 1 : 0
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
        const repositoryPayload = this.getRepositoryPayload(repositoryData, payload.sourcemapPath)
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

  // Looks for the sourcemaps on disk and returns the associated payloads.
  private getMatchingRNSourcemapFiles = (bundleName: string): RNSourcemap[] => [
    new RNSourcemap(bundleName, this.sourcemap!),
  ]

  private getPayloadsToUpload = async (useGit: boolean, bundleName: string): Promise<RNSourcemap[]> => {
    const payloads = this.getMatchingRNSourcemapFiles(bundleName)
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
      apiKey: this.config.apiKey,
      baseUrl: getBaseSourcemapIntakeUrl(this.config.datadogSite),
      headers: new Map([
        ['DD-EVP-ORIGIN', 'datadog-ci_react-native'],
        ['DD-EVP-ORIGIN-VERSION', this.cliVersion],
      ]),
      overrideUrl: 'api/v2/srcmap',
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

      if (this.removeSourcesContent) {
        try {
          this.context.stdout.write(renderRemoveSourcesContentWarning())
          sourcemap.removeSourcesContentFromSourceMap()
        } catch (error) {
          this.context.stdout.write(renderFailedSourcesContentRemovalError(sourcemap, error.message))
        }
      }

      const payload = sourcemap.asMultipartPayload(
        this.cliVersion,
        this.service!,
        this.releaseVersion!,
        this.projectPath,
        this.platform!,
        this.buildVersion!,
        this.context
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
        useGzip: true,
      })
    }
  }
}
