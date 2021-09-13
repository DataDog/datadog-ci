import chalk from 'chalk'
import {spawn} from 'child_process'
import {Command} from 'clipanion'
import crypto from 'crypto'
import os from 'os'
import {parseTags} from '../../helpers/tags'
import {apiConstructor} from './api'
import {APIHelper, CIRCLECI, GITHUB Provider, SUPPORTED_PROVIDERS} from './interfaces'

// We use 127 as exit code for invalid commands since that is what *sh terminals return
const BAD_COMMAND_EXIT_CODE = 127

export class TraceCommand extends Command {
  public static usage = Command.Usage({
    description: 'Trace a command with a custom span and report it to Datadog.',
    details: `
            This command wraps another command, which it will launch, and report a custom span to Datadog.
            See README for details.
        `,
    examples: [
      [
        'Trace a command with name "Say Hello" and report to Datadog',
        'datadog-ci trace --name "Say Hello" -- echo "Hello World"',
      ],
      [
        'Trace a command and report to the datadoghq.eu site',
        'DATADOG_SITE=datadoghq.eu datadog-ci trace -- echo "Hello World"',
      ],
    ],
  })
  private command?: string[]

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private name?: string

  private noFail?: boolean

  public async execute() {
    if (!this.command || !this.command.length) {
      this.context.stderr.write('Missing command to run\n')

      return 1
    }

    const [command, ...args] = this.command
    const id = crypto.randomBytes(5).toString('hex')
    const startTime = new Date().toISOString()
    const childProcess = spawn(command, args, {env: {...process.env, DD_CUSTOM_PARENT_ID: id}, stdio: 'inherit'})
    const [status, signal] = await new Promise((resolve, reject) => {
      childProcess.on('error', (error: Error) => {
        reject(error)
      })

      childProcess.on('close', (exitStatus: number, exitSignal: string) => {
        resolve([exitStatus, exitSignal])
      })
    })
    const endTime = new Date().toISOString()
    const exitCode = status ?? this.signalToNumber(signal) ?? BAD_COMMAND_EXIT_CODE
    const [ciEnvVars, provider] = this.getCIEnvVars()
    if (provider) {
      const api = this.getApiHelper()
      const commandStr = this.command.join(' ')
      await api.reportCustomSpan(
        {
          command: commandStr,
          custom: {
            id,
            parent_id: process.env.DD_CUSTOM_PARENT_ID,
          },
          data: ciEnvVars,
          end_time: endTime,
          is_error: exitCode !== 0,
          name: this.name ?? commandStr,
          start_time: startTime,
          tags: this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {},
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
    if (process.env.GITHUB_ACTIONS || process.env.GITHUB_ACTION) {
      return [
        this.getEnvironmentVars([
          'GITHUB_RUN_ID',
          'GITHUB_WORKFLOW',
          'GITHUB_RUN_NUMBER',
          'GITHUB_WORKSPACE',
          'GITHUB_HEAD_REF',
          'GITHUB_REF',
          'GITHUB_SHA',
          'GITHUB_REPOSITORY',
        ]),
        GITHUB,
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

  private signalToNumber(signal: NodeJS.Signals | null): number | undefined {
    if (!signal) {
      return undefined
    }

    return os.constants.signals[signal] + 128
  }
}

TraceCommand.addPath('trace')
TraceCommand.addOption('noFail', Command.Boolean('--no-fail'))
TraceCommand.addOption('name', Command.String('--name'))
TraceCommand.addOption('command', Command.Rest({required: 1}))
