import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-core/constants'
import {getCISpanTags} from '@datadog/datadog-ci-core/helpers/ci'
import {toBoolean} from '@datadog/datadog-ci-core/helpers/env'
import {enableFips} from '@datadog/datadog-ci-core/helpers/fips'
import {gitRepositoryURL, gitLocalCommitShas, gitCurrentBranch} from '@datadog/datadog-ci-core/helpers/git/get-git-data'
import {Logger, LogLevel} from '@datadog/datadog-ci-core/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-core/helpers/retry'
import {CI_PROVIDER_NAME, CI_ENV_VARS, GIT_REPOSITORY_URL, GIT_SHA} from '@datadog/datadog-ci-core/helpers/tags'
import {getApiHostForSite, getRequestBuilder} from '@datadog/datadog-ci-core/helpers/utils'
import {isAxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import simpleGit from 'simple-git'

/**
 * This command collects environment variables and git information to correlate commits from the
 * source code repository to the configuration repository. This allows to connect pipelines triggering
 * changes on the configuration repository to deployments from gitOps CD providers
 */
export class DeploymentCorrelateCommand extends Command {
  public static paths = [['deployment', 'correlate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate GitOps CD deployments with CI pipelines.',
    details: `
      This command will correlate the pipeline with a GitOps CD deployment.\n
      See README for additional details.
    `,
    examples: [
      ['Correlate an Argo CD deployment', 'datadog-ci deployment correlate --provider argocd'],
      [
        'Correlate ArgoCD deployment manually',
        'datadog-ci deployment correlate --provider argocd --config-repo https://github.com/my-manifests-repo --config-shas 92eb0db6926aaf51b9fb223895b6d8d1c0ff1ff4',
      ],
      [
        'Correlate ArgoCD deployment manually to several commits',
        'datadog-ci deployment correlate --provider argocd --config-repo https://github.com/my-manifests-repo --config-shas 92eb0db6926aaf51b9fb223895b6d8d1c0ff1ff4 --config-shas e996e5c30ba1cb4dc7f634ab4a0a59473741c4de',
      ],
    ],
  })

  private cdProviderParam = Option.String('--provider')
  private configurationRepo = Option.String('--config-repo')
  private configurationShas = Option.Array('--config-shas')
  private dryRun = Option.Boolean('--dry-run', false)

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )

      return 1
    }

    if (!this.cdProviderParam) {
      this.logger.error('Missing CD provider. It must be provided with --provider')

      return 1
    }
    this.cdProviderParam = this.cdProviderParam.toLowerCase()

    const tags = getCISpanTags() || {}

    if (!this.validateTags(tags)) {
      return 1
    }

    let envVars: Record<string, string> = {}
    if (tags[CI_ENV_VARS]) {
      envVars = JSON.parse(tags[CI_ENV_VARS])
      delete tags[CI_ENV_VARS]
    }
    const ciEnv: Record<string, string> = {
      ...tags,
      ...envVars,
    }

    const git = simpleGit({
      baseDir: process.cwd(),
      binary: 'git',
      maxConcurrentProcesses: 2, // max 2 git commands at the same time
    })

    if (!this.configurationRepo) {
      this.configurationRepo = await gitRepositoryURL(git)
    }

    if (this.configurationRepo === undefined || this.configurationRepo === '') {
      this.logger.error('Could not retrieve repository URL, check out a repository or provide it with --config-repo')

      return 1
    }

    if (!this.configurationShas) {
      this.logger.info('Retrieving local git commits')
      const currentBranch = await gitCurrentBranch(git)
      if (!currentBranch) {
        this.logger.error('Could not get current branch')

        return 1
      }
      this.configurationShas = await gitLocalCommitShas(git, currentBranch)
    }

    if (this.configurationShas.length === 0) {
      this.logger.error(
        'Could not retrieve commit SHAs, commit changes and then call this command or provide them with --config-shas'
      )

      return 1
    }

    await this.sendCorrelationData(ciEnv[CI_PROVIDER_NAME], ciEnv, this.config.apiKey)
  }

  private async sendCorrelationData(ciProvider: string, ciEnv: Record<string, string>, apiKey: string) {
    const correlateEvent = {
      type: 'ci_app_deployment_correlate',
      attributes: {
        ci_provider: ciProvider,
        cd_provider: this.cdProviderParam,
        config_repo_url: this.configurationRepo,
        config_commit_shas: this.configurationShas,
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
      // TODO: use `coerceError()`
      this.handleError(error as Error)
    }
  }

  private validateTags(tags: Record<string, string>): boolean {
    if (!tags[GIT_REPOSITORY_URL]) {
      this.logger.error('Could not extract the source code repository URL from the CI environment variables')

      return false
    }
    if (!tags[GIT_SHA]) {
      this.logger.error('Could not extract the commit SHA from the CI environment variables')

      return false
    }

    return true
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
