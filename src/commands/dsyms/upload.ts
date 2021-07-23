import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import path from 'path'
import asyncPool from 'tiny-async-pool'

import {UploadStatus} from '../../helpers/interfaces'
import {apiConstructor} from './api'
import {ApiKeyValidator} from './apikey'
import {InvalidConfigurationError} from './errors'
import {APIHelper, Payload} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderConfigurationError,
  renderDryRunUpload,
  renderFailedUpload,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {getBaseIntakeUrl, getPayloads, getSearchPaths} from './utils'

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
  private maxConcurrency = 20

  constructor() {
    super()
    this.apiKeyValidator = new ApiKeyValidator(this.config.apiKey, this.config.datadogSite)
  }

  public async execute() {
    this.basePath = path.posix.normalize(this.basePath!)
    const cliVersion = require('../../../package.json').version
    const metricsLogger = getMetricsLogger(cliVersion)
    const api = this.getApiHelper()

    const initialTime = Date.now()

    const searchPaths = await getSearchPaths(this.basePath)
    const payloads = await getPayloads(searchPaths)
    const upload = (p: Payload) => this.uploadDSYM(api, metricsLogger.logger, p)
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

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey!)
  }

  private async uploadDSYM(api: APIHelper, metricsLogger: BufferedMetricsLogger, dSYM: Payload): Promise<UploadStatus> {
    try {
      return await retry(
        async (bail) => {
          try {
            if (this.dryRun) {
              this.context.stdout.write(renderDryRunUpload(dSYM))

              return UploadStatus.Success
            }
            await api.uploadDSYM(dSYM, this.context.stdout.write.bind(this.context.stdout))
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
            this.context.stdout.write(renderRetriedUpload(dSYM, e.message, attempt))
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
      if (error.response && error.response.statusText) {
        // Display human readable info about the status code
        this.context.stdout.write(renderFailedUpload(dSYM, `${error.message} (${error.response.statusText})`))
      } else {
        // Default error handling
        this.context.stdout.write(renderFailedUpload(dSYM, error))
      }

      return UploadStatus.Failure
    }
  }
}

UploadCommand.addPath('dsyms', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
