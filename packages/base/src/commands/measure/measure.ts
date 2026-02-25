import type {AxiosError} from 'axios'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {envDDGithubJobName, getGithubJobNameFromLogs, getCIEnv} from '@datadog/datadog-ci-base/helpers/ci'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {parseMeasuresFile} from '@datadog/datadog-ci-base/helpers/tags'
import {getApiHostForSite, getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

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

export class MeasureCommand extends BaseCommand {
  public static paths = [['measure']]

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
      ['Add measures in bulk using a JSON file', 'datadog-ci measure --level job --measures-file my_measures.json'],
    ],
  })

  private level = Option.String('--level')
  private measures = Option.Array('--measures')
  private measuresFile = Option.String('--measures-file')
  private noFail = Option.Boolean('--no-fail')
  private dryRun = Option.Boolean('--dry-run', false)

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (this.level !== 'pipeline' && this.level !== 'job') {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} Level must be one of [pipeline, job]\n`)

      return 1
    }

    const cliMeasures: string[] | undefined = this.measures
    if (!cliMeasures && !this.measuresFile) {
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} --measures or --measures-file is required\n`)

      return 1
    }

    const [measuresFromFile, valid] = parseMeasuresFile(this.context, this.measuresFile)
    if (!valid) {
      // we should fail if attempted to read measures from a file and failed
      return 1
    }

    const measures: Record<string, number> = {
      ...(cliMeasures ? parseMeasures(cliMeasures) : {}),
      ...measuresFromFile,
    }

    if (Object.keys(measures).length === 0) {
      // This can happen for example if the measures file is provided but is empty
      this.context.stderr.write(`${chalk.red.bold('[ERROR]')} No measures found\n`)

      return 1
    }

    try {
      const {provider, ciEnv} = getCIEnv()

      if (this.level !== 'pipeline') {
        const jobName = getGithubJobNameFromLogs(this.context)
        if (jobName) {
          ciEnv[envDDGithubJobName] = jobName
        }
      }

      const exitStatus = await this.sendMeasures(ciEnv, this.level === 'pipeline' ? 0 : 1, provider, measures)
      if (exitStatus !== 0 && this.noFail) {
        this.context.stderr.write(
          `${chalk.yellow.bold('[WARNING]')} sending measures failed but continuing due to --no-fail\n`
        )

        return 0
      } else if (exitStatus === 0 && !this.dryRun) {
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

    if (this.dryRun) {
      this.context.stdout.write(
        `[DRYRUN] Measure request: ${JSON.stringify(this.buildMeasureRequest(ciEnv, level, provider, measures), undefined, 2)}\n`
      )

      return 0
    }

    const request = getRequestBuilder({baseUrl: baseAPIURL, apiKey: this.config.apiKey})

    const doRequest = () =>
      request({
        data: this.buildMeasureRequest(ciEnv, level, provider, measures),
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

  private buildMeasureRequest(
    ciEnv: Record<string, string>,
    level: number,
    provider: string,
    measures: Record<string, number>
  ) {
    return {
      data: {
        attributes: {
          ci_env: ciEnv,
          ci_level: level,
          metrics: measures,
          provider,
        },
        type: 'ci_custom_metric',
      },
    }
  }
}
