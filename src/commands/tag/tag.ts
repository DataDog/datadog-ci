import chalk from 'chalk'
import {Command} from 'clipanion'
import {getCIEnv} from '../../helpers/ci'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getApiHostForSite, getRequestBuilder} from '../../helpers/utils'

export class TagCommand extends Command {
  public static usage = Command.Usage({
    description: 'Add tags to a CI Pipeline trace pipeline or job span in Datadog.',
    details: `
            This command when run from a supported CI provider sends an arbitrary st of key:value
            tags to Datadog to include in the CI Visibility traces.
    `,
    examples: [
      ['Add a team tag to the current pipeline', 'datadog-ci tag --level pipeline --tags team:backend'],
      [
        'Tag the current CI job with the current go version',
        'datadog-ci tag --level job --tags "go.version:`go version`"',
      ],
    ],
  })
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private level?: string
  private noFail?: boolean
  private tags?: string[]

  public async execute() {
    if (this.level !== 'pipeline' && this.level !== 'job') {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Level must be one of [pipeline, job]\n`)

      return 1
    }

    const tags = {
      ...(this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}),
      ...(this.tags ? parseTags(this.tags) : {}),
    }

    if (Object.keys(tags).length === 0) {
      this.context.stderr.write(
        `${chalk.red.bold('[ERROR]')} DD_TAGS environment variable or --tags command line argument is required\n`
        )

      return 1
    }

    try {
      const {provider, ciEnv} = getCIEnv()
      // For GitHub only the pipeline level is supported as there is no way to identify the job from the runner.
      if (provider === 'github' && this.level === 'job') {
        this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Cannot use level "job" for GitHub Actions.`)

        return 1
      }

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
    const instance = getRequestBuilder({baseUrl: baseAPIURL, apiKey: this.config.apiKey})

    const doRequest = async () => {
      const resp = await instance({
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

      return resp
    }

    try {
      await retryRequest(doRequest, {
        onRetry: (e, attempt) => {
          this.context.stderr.write(
            chalk.yellow(`[attempt ${attempt}] Could not send tags. Retrying...: ${e.message}\n`)
          )
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Could not send tags: ${error.message}\n`)

      return 1
    }

    return 0
  }
}

TagCommand.addPath('tag')
TagCommand.addOption('noFail', Command.Boolean('--no-fail'))
TagCommand.addOption('tags', Command.Array('--tags'))
TagCommand.addOption('level', Command.String('--level'))
