import {AxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import simpleGit from 'simple-git'
import * as t from 'typanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
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
    This command sends details to Datadog about a deployment of a service.\n
    See README for more details.
    `,
    examples: [
      [
        'Send a DORA deployment event for a service to the prod environment',
        'datadog-ci dora deployment --service my-service --env prod \\\n' +
          '    --started-at 1699960648 --finished-at 1699961048 \\\n' +
          '    --git-repository-url https://github.com/my-organization/my-repository \\\n' +
          '    --git-commit-sha 102836a25f5477e571c73d489b3f0f183687068e \\\n' +
          '    --version 1.0.0',
      ],
      [
        'Send a DORA deployment event with automatically extracted Git info (for deployments triggered from CI in the same repository as the application). The deployment is assumed to target the current HEAD commit',
        'datadog-ci dora deployment --service my-service --started-at $deploy_start --finished-at `date +%s`',
      ],
      [
        'Send a DORA deployment event to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci dora deployment --service my-service --started-at $deploy_start',
      ],
      [
        'Send a DORA deployment event without git info. Change Lead Time is not available without Git info. The deployment finished-at is set to the current time',
        'datadog-ci dora deployment --service my-service --started-at $deploy_start --skip-git',
      ],
      [
        'Send a DORA deployment event providing the service name and env through environment vars',
        'DD_SERVICE=my-service DD_ENV=prod datadog-ci dora deployment --started-at $deploy_start',
      ],
    ],
  })

  private serviceParam = Option.String('--service', {env: 'DD_SERVICE'})
  private service!: string
  private env = Option.String('--env', {env: 'DD_ENV'})

  private startedAt = Option.String('--started-at', {
    required: true,
    validator: t.isDate(),
    description: 'In Unix seconds or ISO8601 (Examples: 1699960648, 2023-11-14T11:17:28Z)',
  })
  private finishedAt = Option.String('--finished-at', {
    validator: t.isDate(),
    description: 'In Unix seconds or ISO8601 (Examples: 1699961048, 2023-11-14T11:24:08Z)',
  })

  private version = Option.String('--version', {
    description: 'The version of the service being deployed',
  })

  private team = Option.String('--team', {
    description: 'The team responsible for the deployment',
  })

  private customTags = Option.Array('--custom-tags', {
    description: 'Custom tags to add to the deployment event in the format key:value. Max 100 tags per deployment event.',
  })

  private gitInfo?: GitInfo
  private gitRepoURL = Option.String('--git-repository-url', {
    description: 'Example: https://github.com/DataDog/datadog-ci.git',
  })
  private gitCommitSHA = Option.String('--git-commit-sha', {
    description: 'Example: 102836a25f5477e571c73d489b3f0f183687068e',
  })
  private skipGit = Option.Boolean('--skip-git', false, {
    description: 'Disables sending git URL and SHA. Change Lead Time will not be available',
  })

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private verbose = Option.Boolean('--verbose', false, {hidden: true})
  private dryRun = Option.Boolean('--dry-run', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    if (this.serviceParam) {
      this.service = this.serviceParam
    } else {
      this.logger.error('Missing service. It must be provided with --service or the DD_SERVICE env var')

      return 1
    }

    if (this.startedAt > (this.finishedAt || new Date())) {
      this.logger.error('--started-at cannot be after --finished-at')

      return 1
    }

    if (this.skipGit) {
      this.gitInfo = undefined
    } else if (this.gitRepoURL && this.gitCommitSHA) {
      this.gitInfo = {repoURL: this.gitRepoURL, commitSHA: this.gitCommitSHA}
    } else {
      this.gitInfo = await this.getGitInfo()
      this.logger.warn(renderGitWarning(this.gitInfo))
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
      deployment.git = this.gitInfo
    }
    if (this.version) {
      deployment.version = this.version
    }
    if (this.team) {
      deployment.team = this.team
    }
    if (this.customTags) {
      deployment.customTags = this.customTags
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
