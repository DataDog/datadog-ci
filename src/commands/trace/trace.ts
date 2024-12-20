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

// We use 127 as exit code for invalid commands since that is what *sh terminals return
const BAD_COMMAND_EXIT_CODE = 127

export class TraceCommand extends Command {
  public static paths = [['trace']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Trace a command with a custom span and report it to Datadog.',
    details: `
      This command wraps another command, which it will launch, and report a custom span to Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Trace a command with name "Say Hello" and report to Datadog',
        'datadog-ci trace --name "Say Hello" -- echo "Hello World"',
      ],
      [
        'Trace a command with name "Say Hello", extra tags and measures and report to Datadog',
        'datadog-ci trace --name "Say Hello" --tags key1:value1 --tags key2:value2 --measures key3:3.5 --measures key4:8 -- echo "Hello World"',
      ],
      [
        'Trace a command and report to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci trace -- echo "Hello World"',
      ],
    ],
  })

  private command = Option.Rest({required: 1})
  private measures = Option.Array('--measures')
  private name = Option.String('--name')
  private noFail = Option.Boolean('--no-fail')
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

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.command || !this.command.length) {
      this.context.stderr.write('Missing command to run\n')

      return 1
    }

    const [command, ...args] = this.command
    const id = crypto.randomBytes(5).toString('hex')
    const startTime = new Date().toISOString()
    const childProcess = spawn(command, args, {
      env: {...process.env, DD_CUSTOM_PARENT_ID: id},
      stdio: ['inherit', 'inherit', 'pipe'],
    })
    const chunks: Buffer[] = []
    childProcess.stderr.pipe(this.context.stderr)
    const stderrCatcher: Promise<string> = new Promise((resolve, reject) => {
      childProcess.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      childProcess.stderr.on('error', (err) => reject(err))
      childProcess.stderr.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
    const [status, signal] = await new Promise<[number, NodeJS.Signals]>((resolve, reject) => {
      childProcess.on('error', (error: Error) => {
        reject(error)
      })

      childProcess.on('close', (exitStatus: number, exitSignal: NodeJS.Signals) => {
        resolve([exitStatus, exitSignal])
      })
    })

    const stderr: string = await stderrCatcher
    const endTime = new Date().toISOString()
    const exitCode: number = status ?? this.signalToNumber(signal) ?? BAD_COMMAND_EXIT_CODE
    const provider = getCIProvider()
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      if (this.noFail) {
        this.context.stdout.write(
          `Unsupported CI provider "${provider}". Not failing since the --no-fail option was used.\n`
        )

        return exitCode
      }
      this.context.stdout.write(
        `Unsupported CI provider "${provider}". Supported providers are: ${SUPPORTED_PROVIDERS.join(', ')}\n`
      )

      return 1
    }
    const ciSpanTags = getCISpanTags()
    const commandStr = this.command.join(' ')
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
      ci_provider: provider,
      span_id: id,
      command: commandStr,
      name: this.name ?? commandStr,
      start_time: startTime,
      end_time: endTime,
      error_message: stderr,
      exit_code: exitCode,
      tags: {...gitSpanTags, ...ciSpanTags, ...userGitSpanTags, ...cliTags, ...envVarTags},
      measures,
    })

    return exitCode
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
