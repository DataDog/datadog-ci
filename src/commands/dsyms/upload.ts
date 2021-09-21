import chalk from 'chalk'
import {Command} from 'clipanion'
import path from 'path'
import asyncPool from 'tiny-async-pool'

import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {upload, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'
import {Dsym} from './interfaces'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedUpload,
  renderRetriedUpload,
  renderSuccessfulCommand,
  renderUpload,
} from './renderer'
import {getBaseIntakeUrl, getMatchingDSYMFiles, isZipFile, unzipToTmpDir} from './utils'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload dSYM files to Datadog.',
    details: `
            This command will upload all dSYM files to Datadog in order to symbolicate crash reports received by Datadog.
            See README for details.
        `,
    examples: [
      ['Upload all dSYM files in Derived Data path', 'datadog-ci dsyms upload ~/Library/Developer/Xcode/DerivedData'],
      [
        'Upload all dSYM files in a zip file (this is usually the case if your app has Bitcode enabled)',
        'datadog-ci dsyms upload /path/to/folder/my_file.zip',
      ],
    ],
  })

  private basePath!: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private dryRun = false
  private maxConcurrency = 20

  public async execute() {
    this.basePath = path.posix.normalize(this.basePath)
    const cliVersion = require('../../../package.json').version
    const metricsLogger = getMetricsLogger({
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [`cli_version:${cliVersion}`],
      prefix: 'datadog.ci.dsyms.',
    })

    this.context.stdout.write(renderCommandInfo(this.basePath, this.maxConcurrency, this.dryRun))

    const initialTime = Date.now()

    let searchPath = this.basePath
    if (await isZipFile(this.basePath)) {
      searchPath = await unzipToTmpDir(this.basePath)
    }

    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
    const payloads = await getMatchingDSYMFiles(searchPath, this.context)
    const validPayloads = payloads.filter((payload) => payload !== undefined) as Dsym[]
    const requestBuilder = this.getRequestBuilder()
    const uploadDSYM = this.uploadDSYM(requestBuilder, metricsLogger, apiKeyValidator)
    try {
      const results = await asyncPool(this.maxConcurrency, validPayloads, uploadDSYM)
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

  private getRequestBuilder(): RequestBuilder {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return getRequestBuilder({
      apiKey: this.config.apiKey!,
      baseUrl: getBaseIntakeUrl(),
    })
  }

  private uploadDSYM(
    requestBuilder: RequestBuilder,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): (dSYM: Dsym) => Promise<UploadStatus> {
    return async (dSYM: Dsym) => {
      const payload = await dSYM.asMultipartPayload()
      if (this.dryRun) {
        this.context.stdout.write(`[DRYRUN] ${renderUpload(dSYM)}`)

        return UploadStatus.Success
      }

      return upload(requestBuilder)(payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(dSYM, e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempts) => {
          this.context.stdout.write(renderRetriedUpload(dSYM, e.message, attempts))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          this.context.stdout.write(renderUpload(dSYM))
        },
        retries: 5,
      })
    }
  }
}

UploadCommand.addPath('dsyms', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
