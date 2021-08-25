import chalk from 'chalk'
import {spawnSync} from 'child_process'
import {Command} from 'clipanion'
import crypto from 'crypto'
import os from 'os'
import {performance} from 'perf_hooks'
import {parseTags} from '../../helpers/tags'
import {apiConstructor} from './api'
import {APIHelper} from './interfaces'

export class TraceCommand extends Command {
  public static usage = Command.Usage({
    description: 'Trace a command with a custom span and report it to Datadog.',
    details: `
            This command wraps another command, which it will launch, and report a custom span to Datadog.
            See README for details.
        `,
    examples: [
      ['Trace a command and report to Datadog', 'datadog-ci trace echo "Hello World"'],
      [
        'Trace a command and report to the datadoghq.eu site',
        'DATADOG_SITE=datadoghq.eu datadog-ci trace echo "Hello World"',
      ],
    ],
  })

  private command?: string[]

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
    const t0 = performance.now()
    const spawnResult = spawnSync(command, args, {env: {...process.env, DD_CUSTOM_PARENT_ID: id}, stdio: 'inherit'})
    const t1 = performance.now()
    const duration = t1 - t0
    const exitCode = spawnResult.status ?? this.signalToNumber(spawnResult.signal!) ?? 127
    const api = this.getApiHelper()
    const [provider, data] = this.getData()
    await api.reportCustomSpan(
      {
        data,
        duration,
        id,
        is_error: exitCode !== 0,
        parent_id: process.env.DD_CUSTOM_PARENT_ID,
        tags: this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {},
      },
      provider
    )

    return exitCode
  }

  public getData(): [string, Record<string, string>] {
    if (process.env.CIRCLECI) {
      return [
        'circleci',
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
      ]
    }
    throw new Error('Cannot detect any CI Provider. This command only works if run as part of your CI.')
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
    if (process.env.DATADOG_SITE || process.env.DD_SITE) {
      return `https://webhooks-http-intake.logs.${process.env.DATADOG_SITE || process.env.DD_SITE}`
    }

    return 'https://webhooks-http-intake.logs.datadoghq.com'
  }

  private getEnvironmentVars(keys: string[]): Record<string, string> {
    return keys.filter((key) => key in process.env).reduce((accum, key) => ({...accum, [key]: process.env[key]!}), {})
  }

  private signalToNumber(signal?: string): number | undefined {
    if (!signal) {
      return undefined
    }

    return (os.constants.signals as any)[signal!] + 128
  }
}

TraceCommand.addPath('trace')
TraceCommand.addOption('command', Command.Rest({required: 1}))
