import {TagCommand} from '@datadog/datadog-ci-base/commands/tag/tag'
import { getCIEnv } from '@datadog/datadog-ci-base/helpers/ci'
import { enableFips } from '@datadog/datadog-ci-base/helpers/fips'
import { retryRequest } from '@datadog/datadog-ci-base/helpers/retry'
import { parseTags, parseTagsFile } from '@datadog/datadog-ci-base/helpers/tags'
import { getApiHostForSite, getRequestBuilder } from '@datadog/datadog-ci-base/helpers/utils'
import { AxiosError } from 'axios'
import chalk from 'chalk'

export class PluginCommand extends TagCommand {
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
      } else if (exitStatus === 0) {
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
    const request = getRequestBuilder({baseUrl: baseAPIURL, apiKey: this.config.apiKey})

    const doRequest = () =>
      request({
        data: {
          data: {
            attributes: {
              ci_env: ciEnv,
              ci_level: level,
              provider,
              tags,
            },
            type: 'ci_custom_tag',
          },
        },
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
}
