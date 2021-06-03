import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'

import {apiConstructor} from './api'
import {ApiKeyValidator} from './apikey'
import {InvalidConfigurationError} from './errors'
import {getRepositoryData, newSimpleGit, RepositoryData} from './git'
import {APIHelper, Payload} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderConfigurationError,
  renderFailedUpload,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

const errorCodesNoRetry = [400, 403, 413]

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
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private dryRun = false

  constructor() {
    super()
    this.apiKeyValidator = new ApiKeyValidator(this.config.apiKey, this.config.datadogSite)
  }

  public async execute() {
    const initialTime = new Date().getTime()
    const api = this.getApiHelper()
    this.context.stdout.write(renderCommandInfo(this.dryRun))

    const cliVersion = require('../../../package.json').version
    const metricsLogger = getMetricsLogger(cliVersion)
    const payload = await this.getPayloadToUpload(cliVersion)
    if (payload === undefined) {
      return 0
    }
    try {
      await this.uploadRepository(api, metricsLogger.logger, payload)
      const totalTime = (Date.now() - initialTime) / 1000

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

  // Fills the 'repository' field of each payload with data gathered using git.
  private getPayloadToUpload = async (cliVersion: string) => {
    const repositoryData = await getRepositoryData(await newSimpleGit(), this.context.stdout, this.repositoryURL)
    if (repositoryData === undefined) {
      return
    }

    return {
      cliVersion,
      gitCommitSha: repositoryData.hash,
      gitRepositoryPayload: this.getRepositoryPayload(repositoryData),
      gitRepositoryURL: repositoryData.remote,
    }
  }

  // GetRepositoryPayload generates the repository payload.
  private getRepositoryPayload = (repositoryData: RepositoryData): string =>
    JSON.stringify({
      data: [
        {
          files: repositoryData.trackedFiles,
          hash: repositoryData.hash,
          repository_url: repositoryData.remote,
        },
      ],
      // Make sure to update the version if the format of the JSON payloads changes in any way.
      version: 1,
    })

  private async uploadRepository(api: APIHelper, metricsLogger: BufferedMetricsLogger, repository: Payload) {
    try {
      return await retry(
        async (bail) => {
          try {
            if (this.dryRun) {
              return
            }
            await api.uploadRepository(repository, this.context.stdout.write.bind(this.context.stdout))
            metricsLogger.increment('success', 1)

            return
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

            return
          }
        },
        {
          onRetry: (e, attempt) => {
            metricsLogger.increment('retries', 1)
            this.context.stdout.write(renderRetriedUpload(e.message, attempt))
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
        this.context.stdout.write(renderFailedUpload(`${error.message} (${error.response.statusText})`))
      } else {
        // Default error handling
        this.context.stdout.write(renderFailedUpload(error))
      }
    }
  }
}

UploadCommand.addPath('commit', 'upload')
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
