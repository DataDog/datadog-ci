import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import {isInteger} from '../../helpers/validation'

import {apiConstructor} from './api'
import {APIHelper, DeploymentEvent} from './interfaces'
import {
  renderDryRun,
  renderFailedRequest,
  renderRequest,
  renderRetriedRequest,
  renderSuccessfulRequest,
} from './renderer'

const nonRetriableErrorCodes = [400, 403]

export class SendDeploymentEvent extends Command {
  public static paths = [['dora', 'deployment']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Send a new Deployment event for DORA Metrics to Datadog.',
    details: `
      This command will send details about a service Deployment to Datadog.\n
      See README for details.
    `,
    examples: [['TODO', 'datadog-ci dora deployment --service my-service ']],
  })

  private service = Option.String('--service', {required: true, env: 'DD_SERVICE'})
  private env = Option.String('--env', {env: 'DD_ENV'})
  private gitRepositoryURL = Option.String('--repository-url')
  private gitCommitSha = Option.String('--commit-sha')
  private startedAt = Option.String('--started-at', {required: true, validator: isInteger()})
  private finishedAt = Option.String('--finished-at', {required: true, validator: isInteger()})
  private verbose = Option.Boolean('--verbose', false)
  private dryRun = Option.Boolean('--dry-run', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    const api = this.getApiHelper()
    await this.sendDeploymentEvent(api, this.buildDeploymentEvent())

    if (!this.dryRun) {
      this.logger.info(renderSuccessfulRequest(this.service))
    }
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(this.config.apiKey)
  }

  private buildDeploymentEvent(): DeploymentEvent {
    // TODO:
    return {
      service: 'test-service',
    }
  }

  private async sendDeploymentEvent(api: APIHelper, deployment: DeploymentEvent) {
    if (this.dryRun) {
      this.logger.info(renderDryRun(this.service))

      return
    }

    try {
      this.logger.info(renderRequest(this.service))
      await retryRequest(() => api.sendDeploymentEvent(deployment), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(renderRetriedRequest(this.service, e.message, attempt))
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(renderFailedRequest(this.service, error))
      if (error.response) {
        // If it's an axios error
        if (!nonRetriableErrorCodes.includes(error.response.status)) {
          return
        }
      }
      throw error
    }
  }
}
