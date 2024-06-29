import type {AxiosError} from 'axios'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {getCIEnv, PROVIDER_TO_DISPLAY_NAME} from '../../helpers/ci'
import {retryRequest} from '../../helpers/retry'
import {getApiHostForSite, getRequestBuilder} from '../../helpers/utils'

export const parseMeasures = (measures: string[]) =>
  measures.reduce((acc, keyValue) => {
    if (!keyValue.includes(':')) {
      throw new Error(`invalid measures key value pair "${keyValue}"`)
    }

    const [key, value] = keyValue.split(':', 2)
    const floatVal = parseFloat(value)
    if (isNaN(floatVal)) {
      throw new Error('value is not numeric')
    }

    return {
      ...acc,
      [key]: floatVal,
    }
  }, {})

export class MeasureCommand extends Command {
  public static paths = [['measure'], ['metric']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Add measures to a CI Pipeline trace pipeline or job span in Datadog.',
    details: `
            This command when run from a supported CI provider sends an arbitrary set of key:value
            numeric tags to Datadog to include in the CI Visibility traces.
    `,
    examples: [
      ['Add a binary size to the current pipeline', 'datadog-ci measure --level pipeline --measures binary.size:500'],
      [
        'Tag the current CI job with a command runtime',
        'datadog-ci measure --level job --measures command.runtime:67.1',
      ],
    ],
  })

  private level = Option.String('--level')
  private metrics = Option.Array('--metrics', {hidden: true})
  private measures = Option.Array('--measures')
  private noFail = Option.Boolean('--no-fail')

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
  }

  public async execute() {
    if (this.path[0] === 'metric') {
      this.context.stdout.write(
        chalk.yellow(`[WARN] The "metric" command is deprecated. Please use the "measure" command instead.\n`)
      )
    }

    if (this.level !== 'pipeline' && this.level !== 'job') {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Level must be one of [pipeline, job]\n`)

      return 1
    }

    if ((!this.measures || this.measures.length === 0) && (!this.metrics || this.metrics.length === 0)) {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} --measures is required\n`)

      return 1
    }

    if (this.metrics) {
      this.context.stdout.write(
        `${chalk.yellow.yellow(`[WARN] The "--metrics" flag is deprecated. Please use "--measures" flag instead.\n`)}`
      )
    }

    const rawMeasures = (this.measures || this.metrics)!
    try {
      const measures = parseMeasures(rawMeasures)
      const {provider, ciEnv} = getCIEnv()

      const exitStatus = await this.sendMeasures(ciEnv, this.level === 'pipeline' ? 0 : 1, provider, measures)
      if (exitStatus !== 0 && this.noFail) {
        this.context.stderr.write(
          `${chalk.yellow.bold('[WARNING]')} sending measures failed but continuing due to --no-fail\n`
        )

        return 0
      } else if (exitStatus === 0) {
        this.context.stdout.write('Measures sent\n')
      }

      return exitStatus
    } catch (error) {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} ${error.message}\n`)

      return 1
    }
  }

  private async sendMeasures(
    ciEnv: Record<string, string>,
    level: number,
    provider: string,
    measures: Record<string, number>
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
              metrics: measures,
              provider,
            },
            type: 'ci_custom_metric',
          },
        },
        method: 'post',
        url: 'api/v2/ci/pipeline/metrics',
      })

    try {
      await retryRequest(doRequest, {
        onRetry: (e, attempt) => {
          this.context.stderr.write(
            chalk.yellow(`[attempt ${attempt}] Could not send measures. Retrying...: ${e.message}\n`)
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
      `${chalk.red.bold('[ERROR]')} Could not send measures: ` +
        `${error.response ? JSON.stringify(error.response.data, undefined, 2) : ''}\n`
    )
  }
}
