import {spawn} from 'child_process'
import os from 'os'

import {Command, Option} from 'clipanion'

import {CustomSpanCommand} from './helper'

// We use 127 as exit code for invalid commands since that is what *sh terminals return
const BAD_COMMAND_EXIT_CODE = 127

export class TraceCommand extends CustomSpanCommand {
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
      [
        'Trace a command without capturing its arguments (e.g. when they contain secrets)',
        'datadog-ci trace --no-capture -- ./deploy.sh --token "$SECRET"',
      ],
    ],
  })

  private command = Option.Rest({required: 1})
  private name = Option.String('--name')
  private noFail = Option.Boolean('--no-fail')
  private noCapture = Option.Boolean('--no-capture')

  public async execute() {
    this.tryEnableFips()

    if (!this.command || !this.command.length) {
      this.context.stderr.write('Missing command to run\n')

      return 1
    }

    const id = this.generateSpanId()
    const [command, ...args] = this.command
    const startTime = new Date()
    const childProcess = spawn(command, args, {
      env: {...process.env, DD_CUSTOM_PARENT_ID: id},
      stdio: ['inherit', 'inherit', 'pipe'],
    })
    const chunks: Buffer[] = []
    // `{end: false}`: don't end `context.stderr` when the child closes, so the post-child
    // `--no-fail` diagnostic below can still be written without a "write after end" error
    // on regular Writable streams (`process.stderr` tolerates it, but others don't).
    childProcess.stderr.pipe(this.context.stderr, {end: false})
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
    const endTime = new Date()
    const exitCode: number = status ?? this.signalToNumber(signal) ?? BAD_COMMAND_EXIT_CODE
    // With `--no-capture`, only report the executable name so that potentially sensitive
    // arguments (tokens, secrets, etc.) are not sent to Datadog. The child still runs with
    // the full argument list above; only what we report is trimmed.
    const commandStr = this.noCapture ? command : this.command.join(' ')

    const res = await this.executeReportCustomSpan(id, startTime, endTime, {
      command: commandStr,
      name: this.name ?? commandStr,
      error_message: stderr,
      exit_code: exitCode,
    })

    if (res !== 0) {
      if (this.noFail) {
        this.context.stderr.write('note: Not failing since --no-fail provided\n')

        return exitCode
      }

      return res
    }

    return exitCode
  }

  private signalToNumber(signal: NodeJS.Signals | null): number | undefined {
    if (!signal) {
      return undefined
    }

    return os.constants.signals[signal] + 128
  }
}
