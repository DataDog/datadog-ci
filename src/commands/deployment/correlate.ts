import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import simpleGit from 'simple-git'

import {getCISpanTags} from '../../helpers/ci'
import {gitRepositoryURL, gitLocalCommitShas, gitCurrentBranch} from '../../helpers/git/get-git-data'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import { CI_PROVIDER_NAME, CI_ENV_VARS } from '../../helpers/tags'
import {getApiHostForSite, getRequestBuilder} from '../../helpers/utils'

/**
 * This command is a wrapper around the datadog-ci tag command, allowing customers to mark CI jobs
 * as deployments and setting specific properties, like the environment or the revision in a simple way.
 */
export class DeploymentCorrelateCommand extends Command {
  public static paths = [['deployment', 'correlate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate gitOps CD deployments with CI pipelines',
    details: `
      This command will correlate the current pipeline.\n
    `,
    examples: [['Mark a CI job as a deployment', 'datadog-ci deployment mark']],
  })

  private cdProviderParam = Option.String('--provider')
  private cdProvider!: string
  private configurationRepo = Option.String('--config-repo')
  private dryRun = Option.Boolean('--dry-run', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )

      return 1
    }

    if (this.cdProviderParam) {
      this.cdProvider = this.cdProviderParam
    } else {
      this.logger.error('Missing CD provider. It must be provided with --provider')

      return 1
    }

    const tags = getCISpanTags() || {}
    if (!tags) {
      this.logger.error('Missing CD provider. It must be provided with --provider')

      return 1
    }
    let envVars : Record<string, string> = {}
    if (tags[CI_ENV_VARS]) {
      envVars = JSON.parse(tags[CI_ENV_VARS]);
      delete tags[CI_ENV_VARS]
    }
    const ciEnv : Record<string, string> = {
      ...tags,
      ...envVars,
    }

    const git = simpleGit({
      baseDir: process.cwd(),
      binary: 'git',
      maxConcurrentProcesses: 2, // max 2 git commands at the same time
    })

    const currentBranch = await gitCurrentBranch(git)
    if (!currentBranch) {
      this.logger.error('Could not get current branch')

      return 1
    }

    let localCommitShas: readonly string[]
    if (this.configurationRepo) {
      localCommitShas = await gitLocalCommitShas(git, currentBranch)
    } else {
      [this.configurationRepo, localCommitShas] = await Promise.all([
        gitRepositoryURL(git),
        gitLocalCommitShas(git, currentBranch),
      ])
    }

    await this.sendCorrelationData(ciEnv[CI_PROVIDER_NAME], localCommitShas, ciEnv, this.config.apiKey)
  }

  private async sendCorrelationData(
    ciProvider: string,
    configCommitShas: readonly string[],
    ciEnv: Record<string, string>,
    apiKey: string
  ) {
    const correlateEvent = {
      type: 'ci_app_deployment_correlate',
      data: {
        ci_provider: ciProvider,
        cd_provider: this.cdProvider,
        config_repo_url: this.configurationRepo,
        config_commit_shas: configCommitShas,
        ci_env: ciEnv,
      },
    }


    if (this.dryRun) {
      this.logger.info(`[DRYRUN] Sending correlation event\n data: ` + JSON.stringify(correlateEvent, undefined, 2))

      return
    }

    const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
    const baseAPIURL = `https://${getApiHostForSite(site)}`
    const request = getRequestBuilder({baseUrl: baseAPIURL, apiKey})
    const doRequest = () =>
      request({
        data: {
          data: correlateEvent,
        },
        method: 'post',
        url: '/api/v2/ci/deployments/correlate',
      })

    try {
      await retryRequest(doRequest, {
        maxTimeout: 30000,
        minTimeout: 5000,
        onRetry: (e, attempt) => {
          this.logger.warn(
            `[attempt ${attempt}] Could not send deployment correlation data. Retrying...: ${e.message}\n`
          )
        },
        retries: 5,
      })
    } catch (error) {
      this.logger.error(`Failed to send deployment correlation data: ${error.message}`)
    }
  }
}
