import {AxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {getCIEnv} from '../../helpers/ci'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {retryRequest} from '../../helpers/retry'
import {parseTags, parseTagsFile} from '../../helpers/tags'
import {getApiHostForSite, getRequestBuilder} from '../../helpers/utils'

import {BaseCommand} from '../..'

export class TagCommand extends BaseCommand {
  public static paths = [['tag']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Add tags to a CI Pipeline trace pipeline or job span in Datadog.',
    details: `
            This command when run from a supported CI provider sends an arbitrary set of key:value
            tags to Datadog to include in the CI Visibility traces.
    `,
    examples: [
      ['Add a team tag to the current pipeline', 'datadog-ci tag --level pipeline --tags team:backend'],
      ['Tag the current CI job with the go version', 'datadog-ci tag --level job --tags "go.version:`go version`"'],
      ['Add tags in bulk using a JSON file', 'datadog-ci tag --level job --tags-file my_tags.json'],
    ],
  })

  private level = Option.String('--level')
  private noFail = Option.Boolean('--no-fail')
  private silent = Option.Boolean('--silent')
  private dryRun = Option.Boolean('--dry-run', false)
  private tags = Option.Array('--tags')
  private tagsFile = Option.String('--tags-file')

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public setLevel(level: string) {
    this.level = level
  }

  public setTags(tags: string[]) {
    this.tags = tags

    // When this command is used by another command (e.g. `deployment mark`), the command options are not resolved
    // and are still Clipanion option constructors: `this.tagsFile` is not a valid path.
    delete this.tagsFile
  }

  public setNoFail(noFail: boolean) {
    this.noFail = noFail
  }

  public setSilent(silent: boolean) {
    this.silent = silent
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (this.level !== 'pipeline' && this.level !== 'job') {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Level must be one of [pipeline, job]\n`)

      return 1
    }

    if (this.silent) {
      this.context.stdout.write = () => {
        return true
      }
      this.context.stderr.write = () => {
        return true
      }
    }

    const [tagsFromFile, valid] = parseTagsFile(this.context, this.tagsFile)
    if (!valid) {
      // we should fail if attempted to read tags from a file and failed
      return 1
    }

    const tags = {
      ...(this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}),
      ...(this.tags ? parseTags(this.tags) : {}),
      ...tagsFromFile,
    }

    if (Object.keys(tags).length === 0) {
      this.context.stderr.write(
        `${chalk.red.bold(
          '[ERROR]'
        )} DD_TAGS environment variable, --tags or --tags-file command line argument is required\n`
      )

      return 1
    }

    try {
      const {provider, ciEnv} = getCIEnv()
      const exitStatus = await this.sendTags(ciEnv, this.level === 'pipeline' ? 0 : 1, provider, tags)
      if (exitStatus !== 0 && this.noFail) {
        this.context.stderr.write(
          `${chalk.yellow.bold('[WARNING]')} sending tags failed but continuing due to --no-fail\n`
        )

        return 0
      } else if (exitStatus === 0 && !this.dryRun) {
        this.context.stdout.write('Tags sent\n')
      }

      return exitStatus
    } catch (error) {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} ${error.message}\n`)

      return 1
    }
  }

  private async sendTags(
    ciEnv: Record<string, string>,
    level: number,
    provider: string,
    tags: Record<string, string>
  ): Promise<number> {
    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
    const baseAPIURL = `https://${getApiHostForSite(site)}`

    if (this.dryRun) {
      this.context.stdout.write(
        `[DRYRUN] Tag request: ${JSON.stringify(this.buildTagRequest(ciEnv, level, provider, tags), undefined, 2)}\n`
      )

      return 0
    }

    const request = getRequestBuilder({baseUrl: baseAPIURL, apiKey: this.config.apiKey})

    const doRequest = () =>
      request({
        data: this.buildTagRequest(ciEnv, level, provider, tags),
        method: 'post',
        url: 'api/v2/ci/pipeline/tags',
      })

    try {
      await retryRequest(doRequest, {
        maxTimeout: 30000,
        minTimeout: 5000,
        onRetry: (e, attempt) => {
          this.context.stderr.write(
            chalk.yellow(`[attempt ${attempt}] Could not send tags. Retrying...: ${e.message}\n`)
          )
        },
        retries: 5,
      })
    } catch (error) {
      this.handleError(error as AxiosError)

      return 1
    }

    return 0
  }

  private handleError(error: AxiosError) {
    this.context.stderr.write(
      `${chalk.red.bold('[ERROR]')} Could not send tags: ` +
        `${error.response ? JSON.stringify(error.response.data, undefined, 2) : ''}\n`
    )
  }

  private buildTagRequest(
    ciEnv: Record<string, string>,
    level: number,
    provider: string,
    tags: Record<string, string>
  ) {
    return {
      data: {
        attributes: {
          ci_env: ciEnv,
          ci_level: level,
          provider,
          tags,
        },
        type: 'ci_custom_tag',
      },
    }
  }
}
