import {FIPS_IGNORE_ERROR_ENV_VAR, FIPS_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import { executePluginCommand } from '@datadog/datadog-ci-base/helpers/plugin'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {getApiHostForSite, getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'
import {isAxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

export class DeploymentCorrelateImageCommand extends Command {
  public static paths = [['deployment', 'correlate-image']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate images with their source commit.',
    details: 'This command will correlate the image with a commit of the application repository.',
  })

  protected commitSha = Option.String('--commit-sha')
  protected repositoryUrl = Option.String('--repository-url')
  protected image = Option.String('--image')
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected dryRun = Option.Boolean('--dry-run', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}

export class PluginCommand extends DeploymentCorrelateImageCommand {
  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private config = {
    apiKey: process.env.DD_API_KEY,
    appKey: process.env.DD_APP_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<number> {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.config.apiKey) {
      this.logger.error(`Missing ${chalk.red.bold('DD_API_KEY')} in your environment.`)

      return 1
    }

    if (!this.config.appKey) {
      this.logger.error(`Missing ${chalk.red.bold('DD_APP_KEY')} in your environment.`)

      return 1
    }

    if (!this.commitSha) {
      this.logger.error('Missing commit SHA. It must be provided with --commit-sha')

      return 1
    }

    if (!this.repositoryUrl) {
      this.logger.error('Missing repository URL. It must be provided with --repository-url')

      return 1
    }

    if (!this.image) {
      this.logger.error('Missing image. It must be provided with --image')

      return 1
    }

    const site = process.env.DD_SITE || 'datadoghq.com'
    const baseAPIURL = `https://${getApiHostForSite(site)}`
    const request = getRequestBuilder({baseUrl: baseAPIURL, apiKey: this.config.apiKey, appKey: this.config.appKey})

    const correlateEvent = {
      type: 'ci_deployment_correlate_image',
      attributes: {
        commit_sha: this.commitSha,
        repository_url: this.repositoryUrl,
        image: this.image,
      },
    }

    if (this.dryRun) {
      this.logger.info(`[DRYRUN] Sending correlation event\n data: ` + JSON.stringify(correlateEvent, undefined, 2))

      return 0
    }

    const doRequest = () =>
      request({
        data: {
          data: correlateEvent,
        },
        method: 'post',
        url: '/api/v2/ci/deployments/correlate-image',
      })

    try {
      await retryRequest(doRequest, {
        maxTimeout: 30000,
        minTimeout: 5000,
        onRetry: (e, attempt) => {
          this.logger.warn(`[attempt ${attempt}] Could not send correlation event. Retrying...: ${e.message}\n`)
        },
        retries: 5,
      })
    } catch (error) {
      this.handleError(error as Error)
    }

    return 0
  }

  private handleError(error: Error) {
    this.context.stderr.write(
      `${chalk.red.bold('[ERROR]')} Could not send deployment correlation data: ${
        isAxiosError(error)
          ? JSON.stringify(
              {
                status: error.response?.status,
                response: error.response?.data as unknown,
              },
              undefined,
              2
            )
          : error.message
      }\n`
    )
  }
}
