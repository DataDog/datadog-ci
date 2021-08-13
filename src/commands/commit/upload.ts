import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'

import {ApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {ICONS} from '../../helpers/formatting'
import {apiConstructor, APIHelper, UploadStatus, uploadWithRetry} from '../../helpers/upload'
import {datadogSite, getBaseIntakeUrl} from './api'
import {getCommitInfo, newSimpleGit} from './git'
import {CommitInfo} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderSuccessfulCommand,
} from './renderer'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: 'Report the current commit details to Datadog.',
    details: `
            This command will upload the commit details to Datadog in order to create links to your repositories inside DataDog's UI.
            See README for details.
        `,
    examples: [['Upload the current commit details', 'datadog-ci report-commits upload']],
  })

  public repositoryURL?: string

  private apiKeyValidator: ApiKeyValidator
  private cliVersion: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }
  private dryRun = false

  constructor() {
    super()
    this.apiKeyValidator = new ApiKeyValidator(this.config.apiKey, datadogSite)
    this.cliVersion = require('../../../package.json').version
  }

  public async execute() {
    const initialTime = new Date().getTime()
    const api = this.getApiHelper()
    this.context.stdout.write(renderCommandInfo(this.dryRun))

    const metricsLogger = getMetricsLogger(this.cliVersion)
    const payload = await getCommitInfo(await newSimpleGit(), this.context.stdout, this.repositoryURL)
    if (payload === undefined) {
      return 0
    }
    try {
      const status = await this.uploadRepository(api, metricsLogger.logger, payload)
      const totalTime = (Date.now() - initialTime) / 1000

      if (status !== UploadStatus.Success) {
        this.context.stdout.write(chalk.red(`${ICONS.FAILED} Error uploading commit information.`))

        return 1
      }
      this.context.stdout.write(renderSuccessfulCommand(totalTime, this.dryRun))
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

  private async uploadRepository(api: APIHelper, metricsLogger: BufferedMetricsLogger, commitInfo: CommitInfo) {
    const payload = commitInfo.asMultipartPayload(this.cliVersion)
    if (this.dryRun) {
      return UploadStatus.Success
    }

    return uploadWithRetry(payload, {
      api,
      apiKeyValidator: this.apiKeyValidator,
      datadogSite,
      logger: this.context.stdout.write.bind(this.context.stdout),
      metricsLogger,
      retries: 5,
    })
  }
}

UploadCommand.addPath('commit', 'upload')
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
