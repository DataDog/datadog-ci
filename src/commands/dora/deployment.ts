import {AxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import simpleGit from 'simple-git'
import * as t from 'typanion'

import {gitRepositoryURL, gitHash} from '../../helpers/git/get-git-data'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'

import {apiConstructor} from './api'
import {APIHelper, DeploymentEvent, GitInfo} from './interfaces'
import {
  renderDryRun,
  renderFailedRequest,
  renderGitWarning,
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
  private gitInfo? = {
    repoURL: Option.String('--git-repository-url'),
    commitSHA: Option.String('--git-commit-sha'),
  }
  private skipGit = Option.Boolean('--skip-git', false)
  private startedAt = Option.String('--started-at', {required: true, validator: t.isDate()})
  private finishedAt = Option.String('--finished-at', {validator: t.isDate()})
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

    if (this.skipGit) {
      this.gitInfo = undefined
    } else if (this.gitInfo && (!!this.gitInfo.repoURL || !!this.gitInfo.commitSHA)) {
      this.gitInfo = await this.getGitInfo()
      this.logger.warn(renderGitWarning(this.gitInfo as GitInfo))
    }

    const api = this.getApiHelper()
    await this.sendDeploymentEvent(api, this.buildDeploymentEvent())

    if (!this.dryRun) {
      this.logger.info(renderSuccessfulRequest(this.service))
    }
  }

  private async getGitInfo(): Promise<GitInfo> {
    const git = simpleGit({
      baseDir: process.cwd(),
      binary: 'git',
      // We are invoking at most 5 git commands at the same time.
      maxConcurrentProcesses: 5,
    })
    const [repoURL, commitSHA] = await Promise.all([gitRepositoryURL(git), gitHash(git)])

    return {repoURL, commitSHA}
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
    const deployment: DeploymentEvent = {
      service: this.service,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt || new Date(),
    }
    if (this.env) {
      deployment.env = this.env
    }
    if (this.gitInfo) {
      deployment.git = this.gitInfo as GitInfo
    }

    return deployment
  }

  private async sendDeploymentEvent(api: APIHelper, deployment: DeploymentEvent) {
    if (this.dryRun) {
      this.logger.info(renderDryRun(deployment))

      return
    }

    try {
      this.logger.info(renderRequest(this.service))
      await retryRequest(() => api.sendDeploymentEvent(deployment), {
        onRetry: (e, attempt) => {
          this.logger.warn(renderRetriedRequest(this.service, e, attempt))
        },
        retries: 5,
      })
    } catch (error) {
      this.logger.error(renderFailedRequest(this.service, error as AxiosError))
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
