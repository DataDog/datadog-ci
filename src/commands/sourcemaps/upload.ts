import path from 'path'
import {URL} from 'url'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {glob} from 'glob'

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
import {getRequestBuilder, buildPath} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {version} from '../../helpers/version'

import {Sourcemap} from './interfaces'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedUpload,
  renderGitDataNotAttachedWarning,
  renderGitWarning,
  renderInvalidPrefix,
  renderRetriedUpload,
  renderSourcesNotFoundWarning,
  renderSuccessfulCommand,
  renderUpload,
} from './renderer'
import {getMinifiedFilePath} from './utils'
import {InvalidPayload, validatePayload} from './validation'

export class UploadCommand extends Command {
  public static paths = [['sourcemaps', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload JavaScript sourcemaps to Datadog.',
    details: `
      This command will upload all JavaScript sourcemaps and their corresponding JavaScript file to Datadog in order to un-minify front-end stack traces received by Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Upload all sourcemaps in current directory',
        'datadog-ci sourcemaps upload . --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234',
      ],
      [
        'Upload all sourcemaps in /home/users/ci with 50 concurrent uploads',
        'datadog-ci sourcemaps upload /home/users/ci --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234 --max-concurrency 50',
      ],
    ],
  })

  private basePath = Option.String({required: true})
  private disableGit = Option.Boolean('--disable-git')
  private quiet = Option.Boolean('--quiet', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private minifiedPathPrefix = Option.String('--minified-path-prefix')
  private projectPath = Option.String('--project-path', '')
  private releaseVersion = Option.String('--release-version')
  private repositoryURL = Option.String('--repository-url')
  private service = Option.String('--service')

  private cliVersion = version

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

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

    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePath = path.posix.normalize(this.basePath)
    this.context.stdout.write(
      renderCommandInfo(
        this.basePath,
        this.minifiedPathPrefix,
        this.projectPath,
        this.releaseVersion,
        this.service,
        this.maxConcurrency,
        this.dryRun
      )
    )
    const metricsLogger = getMetricsLogger({
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [`version:${this.releaseVersion}`, `service:${this.service}`, `cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.sourcemaps.',
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
      const results = await doWithMaxConcurrency(this.maxConcurrency, payloads, uploadMultipart)
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
    try {
      const repositoryData = await getRepositoryData(await newSimpleGit(), this.repositoryURL)
      await Promise.all(
        payloads.map(async (payload) => {
          const repositoryPayload = this.getRepositoryPayload(repositoryData, payload.sourcemapPath)
          payload.addRepositoryData({
            gitCommitSha: repositoryData.hash,
            gitRepositoryPayload: repositoryPayload,
            gitRepositoryURL: repositoryData.remote,
          })
        })
      )
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }
  }

  // Looks for the sourcemaps and minified files on disk and returns
  // the associated payloads.
  private getMatchingSourcemapFiles = async (): Promise<Sourcemap[]> => {
    const sourcemapFiles = glob.sync(buildPath(this.basePath, '**/*js.map') /* {windowsPathsNoEscape: true} */)

    return Promise.all(
      sourcemapFiles.map(async (sourcemapPath) => {
        const minifiedFilePath = getMinifiedFilePath(sourcemapPath)
        const [minifiedURL, relativePath] = this.getMinifiedURLAndRelativePath(minifiedFilePath)

        return new Sourcemap(minifiedFilePath, minifiedURL, sourcemapPath, relativePath, this.minifiedPathPrefix)
      })
    )
  }

  private getMinifiedURLAndRelativePath(minifiedFilePath: string): [string, string] {
    const relativePath = minifiedFilePath.replace(this.basePath, '')

    return [buildPath(this.minifiedPathPrefix!, relativePath), relativePath]
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
        ['DD-EVP-ORIGIN', 'datadog-ci_sourcemaps'],
        ['DD-EVP-ORIGIN-VERSION', this.cliVersion],
      ]),
      overrideUrl: 'api/v2/srcmap',
    })
  }

  private isMinifiedPathPrefixValid(): boolean {
    let host
    try {
      const objUrl = new URL(this.minifiedPathPrefix!)
      host = objUrl.host
    } catch {
      // Do nothing.
    }

    if (!host && !this.minifiedPathPrefix!.startsWith('/')) {
      return false
    }

    return true
  }

  private upload(
    requestBuilder: RequestBuilder,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): (sourcemap: Sourcemap) => Promise<UploadStatus> {
    return async (sourcemap: Sourcemap) => {
      try {
        validatePayload(sourcemap, this.context.stdout)
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
        this.projectPath
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
          if (this.quiet) {
            return
          }
          this.context.stdout.write(renderUpload(sourcemap))
        },
        retries: 5,
        useGzip: true,
      })
    }
  }
}
