import chalk from 'chalk'
import {Command} from 'clipanion'

import {newApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {ICONS} from '../../helpers/formatting'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger} from '../../helpers/metrics'
import {upload, UploadOptions, UploadStatus} from '../../helpers/upload'
import {getRequestBuilder} from '../../helpers/utils'
import {datadogSite, getBaseIntakeUrl} from './api'
import {getCommitInfo, newSimpleGit} from './git'
import {CommitInfo} from './interfaces'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderDryRunWarning,
  renderFailedUpload,
  renderRetriedUpload,
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

  private cliVersion: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }
  private dryRun = false

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
  }

  public async execute() {
    const initialTime = new Date().getTime()
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunWarning())
    }

    const metricsLogger = getMetricsLogger({
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [`cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.report_commits.',
    })
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite,
      metricsLogger: metricsLogger.logger,
    })
    const payload = await getCommitInfo(await newSimpleGit(), this.context.stdout, this.repositoryURL)
    if (payload === undefined) {
      return 1
    }
    this.context.stdout.write(renderCommandInfo(payload))
    try {
      const requestBuilder = this.getRequestBuilder()
      const status = await this.uploadRepository(requestBuilder)(payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempt) => {
          this.context.stdout.write(renderRetriedUpload(e.message, attempt))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          return
        },
        retries: 5,
      })
      metricsLogger.logger.increment('success', 1)

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

  private getRequestBuilder(): RequestBuilder {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return getRequestBuilder({
      apiKey: this.config.apiKey!,
      baseUrl: getBaseIntakeUrl(),
      headers: new Map([
        ['DD-EVP-ORIGIN', 'datadog-ci git-metadata'],
        ['DD-EVP-ORIGIN-VERSION', this.cliVersion],
      ]),
      overrideUrl: 'api/v2/srcmap',
    })
  }

  private uploadRepository(
    requestBuilder: RequestBuilder
  ): (commitInfo: CommitInfo, opts: UploadOptions) => Promise<UploadStatus> {
    return async (commitInfo: CommitInfo, opts: UploadOptions) => {
      const payload = commitInfo.asMultipartPayload(this.cliVersion)
      if (this.dryRun) {
        return UploadStatus.Success
      }

      return upload(requestBuilder)(payload, opts)
    }
  }
}

UploadCommand.addPath('git-metadata', 'upload')
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
