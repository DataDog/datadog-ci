import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import path from 'path'
import asyncPool from 'tiny-async-pool'

import {ApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {apiConstructor, APIHelper, UploadStatus, uploadWithRetry} from '../../helpers/upload'
import {Dsym} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderSuccessfulCommand,
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

  private apiKeyValidator: ApiKeyValidator
  private basePath!: string
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
    this.basePath = path.posix.normalize(this.basePath)
    const cliVersion = require('../../../package.json').version
    const metricsLogger = getMetricsLogger(cliVersion)
    const api = this.getApiHelper()

    this.context.stdout.write(renderCommandInfo(this.basePath, this.maxConcurrency, this.dryRun))

    const initialTime = Date.now()

    let searchPath = this.basePath
    if (await isZipFile(this.basePath)) {
      searchPath = await unzipToTmpDir(this.basePath)
    }

    const payloads = await getMatchingDSYMFiles(searchPath)
    const upload = (p: Dsym) => this.uploadDSYM(api, metricsLogger.logger, p)
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

  private async uploadDSYM(api: APIHelper, metricsLogger: BufferedMetricsLogger, dSYM: Dsym): Promise<UploadStatus> {
    const payload = await dSYM.asMultipartPayload()
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

UploadCommand.addPath('dsyms', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
