import crypto from 'crypto'

import {AxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {getCIProvider, getCISpanTags} from '../../helpers/ci'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, Payload, SUPPORTED_PROVIDERS} from './interfaces'

export abstract class CustomSpanCommand extends Command {
  private measures = Option.Array('--measures')
  private dryRun = Option.Boolean('--dry-run')
  private tags = Option.Array('--tags')

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected generateSpanId(): string {
    return crypto.randomBytes(5).toString('hex')
  }

  protected tryEnableFips() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)
  }

  protected async executeReportCustomSpan(
    id: string,
    startTime: Date,
    endTime: Date,
    extraTags: Record<string, any>
  ): Promise<number> {
    const provider = getCIProvider()
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      this.context.stdout.write(
        `Unsupported CI provider "${provider}". Supported providers are: ${SUPPORTED_PROVIDERS.join(', ')}\n`
      )

      return 1
    }
    const ciSpanTags = getCISpanTags()
    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}
    const cliMeasures = this.measures ? parseTags(this.measures) : {}
    const measures = Object.entries(cliMeasures).reduce((acc, [key, value]) => {
      const parsedValue = parseFloat(value)
      if (!isNaN(parsedValue)) {
        return {...acc, [key]: parsedValue}
      }

      return acc
    }, {})

    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    await this.reportCustomSpan({
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      ci_provider: provider,
      span_id: id,
      tags: {...gitSpanTags, ...ciSpanTags, ...userGitSpanTags, ...cliTags, ...envVarTags},
      measures,
      command: extraTags.command,
      name: extraTags.name,
      error_message: extraTags.error_message,
      exit_code: extraTags.exit_code,
    })

    return 0
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(this.getBaseIntakeUrl(), this.config.apiKey)
  }

  private getBaseIntakeUrl() {
    const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'

    return `https://api.${site}`
  }

  private async reportCustomSpan(payload: Payload) {
    if (this.dryRun) {
      this.context.stdout.write(`${chalk.green.bold('[DRY-RUN]')} Reporting custom span: ${JSON.stringify(payload)}\n`)

      return
    }
    const api = this.getApiHelper()
    try {
      await retryRequest(() => api.reportCustomSpan(payload), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(
            chalk.yellow(`[attempt ${attempt}] Could not report custom span. Retrying...: ${e.message}\n`)
          )
        },
        retries: 5,
      })
    } catch (error) {
      this.handleError(error as AxiosError)
    }
  }

  private handleError(error: AxiosError) {
    this.context.stderr.write(
      `${chalk.red.bold('[ERROR]')} Failed to report custom span: ` +
        `${error.response ? JSON.stringify(error.response.data, undefined, 2) : ''}\n`
    )
  }
}
