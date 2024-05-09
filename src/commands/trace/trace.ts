import {spawn} from 'child_process'
import crypto from 'crypto'
import os from 'os'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'

import {apiConstructor} from './api'
import {APIHelper, CIRCLECI, JENKINS, Payload, Provider, SUPPORTED_PROVIDERS} from './interfaces'

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
        'datadog-ci trace --name "Say Hello" --tags key1:value1 --tags key2:value2 --measured key1:3.5 -- echo "Hello World"',
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
  private tags = Option.Array('--tags')

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  public async execute() {
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
    const [ciEnvVars, provider] = this.getCIEnvVars()
    if (provider) {
      const commandStr = this.command.join(' ')
      const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
      const cliTags = this.tags ? parseTags(this.tags) : {}
      const cliMeasures = (this.measures ? parseTags(this.measures) : {})
      const measures = Object.fromEntries(Object.entries(cliMeasures).map(([key, value]) => [key, parseFloat(value)]))
      await this.reportCustomSpan(
        {
          command: commandStr,
          custom: {
            id,
            parent_id: process.env.DD_CUSTOM_PARENT_ID,
          },
          data: ciEnvVars,
          end_time: endTime,
          error_message: stderr,
          exit_code: exitCode,
          is_error: exitCode !== 0,
          name: this.name ?? commandStr,
          start_time: startTime,
          tags: {
            ...cliTags,
            ...envVarTags,
          },
          measures: measures
        },
        provider
      )
    }

    return exitCode
  }

  public getCIEnvVars(): [Record<string, string>, Provider?] {
    if (process.env.CIRCLECI) {
      return [
        this.getEnvironmentVars([
          'CIRCLE_BRANCH',
          'CIRCLE_BUILD_NUM',
          'CIRCLE_BUILD_URL',
          'CIRCLE_JOB',
          'CIRCLE_NODE_INDEX',
          'CIRCLE_NODE_TOTAL',
          'CIRCLE_PROJECT_REPONAME',
          'CIRCLE_PULL_REQUEST',
          'CIRCLE_REPOSITORY_URL',
          'CIRCLE_SHA1',
          'CIRCLE_TAG',
          'CIRCLE_WORKFLOW_ID',
        ]),
        CIRCLECI,
      ]
    }
    if (process.env.JENKINS_HOME) {
      if (!process.env.DD_CUSTOM_TRACE_ID) {
        this.context.stdout.write(
          `${chalk.yellow.bold(
            '[WARNING]'
          )} Your Jenkins instance does not seem to be instrumented with the Datadog plugin.\n`
        )
        this.context.stdout.write(
          'Please follow the instructions at https://docs.datadoghq.com/continuous_integration/setup_pipelines/jenkins/\n'
        )

        return [{}]
      }

      return [
        this.getEnvironmentVars([
          'BUILD_ID',
          'BUILD_NUMBER',
          'BUILD_TAG',
          'BUILD_URL',
          'DD_CUSTOM_TRACE_ID',
          'EXECUTOR_NUMBER',
          'GIT_AUTHOR_EMAIL',
          'GIT_AUTHOR_NAME',
          'GIT_BRANCH',
          'GIT_COMMIT',
          'GIT_COMMITTER_EMAIL',
          'GIT_COMMITTER_NAME',
          'GIT_URL',
          'GIT_URL_1',
          'JENKINS_URL',
          'JOB_BASE_NAME',
          'JOB_NAME',
          'JOB_URL',
          'NODE_NAME',
          'NODE_LABELS',
          'WORKSPACE',
        ]),
        JENKINS,
      ]
    }
    const errorMsg = `Cannot detect any supported CI Provider. This command only works if run as part of your CI. Supported providers: ${SUPPORTED_PROVIDERS}.`
    if (this.noFail) {
      this.context.stdout.write(
        `${chalk.yellow.bold('[WARNING]')} ${errorMsg} Not failing since the --no-fail options was used.\n`
      )

      return [{}]
    } else {
      throw new Error(errorMsg)
    }
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

    return `https://webhook-intake.${site}`
  }

  private getEnvironmentVars(keys: string[]): Record<string, string> {
    return keys.filter((key) => key in process.env).reduce((accum, key) => ({...accum, [key]: process.env[key]!}), {})
  }

  private async reportCustomSpan(payload: Payload, provider: Provider) {
    const api = this.getApiHelper()
    try {
      await retryRequest(() => api.reportCustomSpan(payload, provider), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(
            chalk.yellow(`[attempt ${attempt}] Could not report custom span. Retrying...: ${e.message}\n`)
          )
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(chalk.red(`Failed to report custom span: ${error.message}\n`))
    }
  }

  private signalToNumber(signal: NodeJS.Signals | null): number | undefined {
    if (!signal) {
      return undefined
    }

    return os.constants.signals[signal] + 128
  }
}
