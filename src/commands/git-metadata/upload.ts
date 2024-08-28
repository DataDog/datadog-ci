import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {newApiKeyValidator} from '../../helpers/apikey'
import {InvalidConfigurationError} from '../../helpers/errors'
import {RequestBuilder} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {getMetricsLogger} from '../../helpers/metrics'
import {getRequestBuilder, timedExecAsync} from '../../helpers/utils'
import {version} from '../../helpers/version'

import {apiHost, datadogSite} from './api'
import {newSimpleGit} from './git'
import {uploadToGitDB} from './gitdb'
import {renderConfigurationError, renderDryRunWarning, renderSuccessfulCommand} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['git-metadata', 'upload']]

  public static usage = Command.Usage({
    category: 'Source Code Integration',
    description: 'Report the current commit details to Datadog.',
    details: `
      This command will upload the commit details to Datadog in order to create links to your repositories inside Datadog's UI.\n
      See README for details.

      Options --git-sync and --no-gitsync are DEPRECATED and will be removed in a future version.
    `,
    examples: [['Upload the current commit details', 'datadog-ci git-metadata upload']],
  })

  private repositoryURL = Option.String('--repository-url')
  private dryRun = Option.Boolean('--dry-run', false)
  private verbose = Option.Boolean('--verbose', false)
  private gitSync = Option.Boolean('--git-sync', false)
  private noGitSync = Option.Boolean('--no-gitsync', false)
  private directory = Option.String('--directory', '')

  private cliVersion = version
  private config = {
    apiKey: process.env.DATADOG_API_KEY ?? process.env.DD_API_KEY,
  }

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  public async execute() {
    const initialTime = Date.now()
    if (this.verbose) {
      this.logger = new Logger((s: string) => {
        this.context.stdout.write(s)
      }, LogLevel.DEBUG)
    }
    if (this.dryRun) {
      this.logger.warn(renderDryRunWarning())
    }

    if (this.directory) {
      // change working dir
      process.chdir(this.directory)
    }

    if (!this.config.apiKey) {
      this.logger.error(
        renderConfigurationError(
          new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment`)
        )
      )

      return 1
    }

    if (this.gitSync) {
      this.logger.warn('Option --git-sync is deprecated as it is now the default behavior')
    }
    if (this.noGitSync) {
      this.logger.warn('Option --no-gitsync is deprecated. This command run was a no-op.')

      return 0
    }

    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.report_commits.',
    })
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite,
      metricsLogger: metricsLogger.logger,
    })

    const apiRequestBuilder = this.getApiRequestBuilder(this.config.apiKey)

    let inError = false
    if (!this.noGitSync) {
      try {
        this.logger.info('Syncing GitDB...')
        const elapsed = await timedExecAsync(this.uploadToGitDB.bind(this), {
          requestBuilder: apiRequestBuilder,
        })
        metricsLogger.logger.increment('gitdb.success', 1)
        this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Successfully synced git DB in ${elapsed} seconds.`)
      } catch (err) {
        this.logger.error(`Could not write to GitDB: ${err}`)
        inError = true
      }
    }

    try {
      await metricsLogger.flush()
    } catch (err) {
      this.logger.warn(`WARN: ${err}`)
    }
    if (inError) {
      this.logger.error('Command failed. See messages above for more details.')

      return 1
    }
    this.logger.info(renderSuccessfulCommand((Date.now() - initialTime) / 1000, this.dryRun))

    return 0
  }

  private async uploadToGitDB(opts: {requestBuilder: RequestBuilder}) {
    await uploadToGitDB(this.logger, opts.requestBuilder, await newSimpleGit(), this.dryRun, this.repositoryURL)
  }

  private getApiRequestBuilder(apiKey: string): RequestBuilder {
    return getRequestBuilder({
      apiKey,
      baseUrl: 'https://' + apiHost,
    })
  }
}
