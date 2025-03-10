import {spawn} from 'child_process'
import crypto from 'crypto'
import os from 'os'

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
import * as validation from '../../helpers/validation'

// We use 127 as exit code for invalid commands since that is what *sh terminals return
const BAD_COMMAND_EXIT_CODE = 127

export class SpanCommand extends Command {
  public static paths = [['span']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Create a custom span and report it to Datadog.',
    details: `
      This command reports a span with custom name and custom duration to Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Create span with name "Get Dependencies" and duration of 10s and report to Datadog',
        'datadog-ci span --name "Get Dependencies" --duration 10000',
      ],
    ],
  })

  // TODO: See measures / tags...
  private measures = Option.Array('--measures')
  private name = Option.String('--name')
  private durationInMs: number | undefined = Option.String('--duration', {
    validator: validation.isInteger(),
  })
  private dryRun = Option.Boolean('--dry-run')
  private tags = Option.Array('--tags')

  // TODO A
  // private fips = Option.Boolean('--fips', false)
  // private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
    // TODO A
    // fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    // fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    // TODO
    // enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.durationInMs) {
      this.context.stdout.write(
        `The span duration must be provided.\n`
      )
      return 1;
    }

    const id = crypto.randomBytes(5).toString('hex')
    const now = new Date()
    const endTime = now.toISOString()
    const startTime = new Date(now.getTime() - this.durationInMs).toISOString()
    console.log(`Creating custom span '${this.name}': ${startTime} -> ${endTime}`)
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

    console.log('ok');
    await this.reportCustomSpan({
      ci_provider: provider,
      span_id: id,
      name: this.name ?? 'Custom Span',
      start_time: startTime,
      end_time: endTime,
      // TODO A: Omit this
      error_message: '',
      exit_code: 0,
      command: 'custom-span',
      tags: {...gitSpanTags, ...ciSpanTags, ...userGitSpanTags, ...cliTags, ...envVarTags},
      measures,
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

  private signalToNumber(signal: NodeJS.Signals | null): number | undefined {
    if (!signal) {
      return undefined
    }

    return os.constants.signals[signal] + 128
  }

  private handleError(error: AxiosError) {
    this.context.stderr.write(
      `${chalk.red.bold('[ERROR]')} Failed to report custom span: ` +
        `${error.response ? JSON.stringify(error.response.data, undefined, 2) : ''}\n`
    )
  }
}

