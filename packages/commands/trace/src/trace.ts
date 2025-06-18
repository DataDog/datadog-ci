import {spawn} from 'child_process'
import os from 'os'

import {Command, Option} from 'clipanion'

import {CustomSpanCommand} from './custom-span-command'

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
    ],
  })

  private command = Option.Rest({required: 1})
  private name = Option.String('--name')
  private noFail = Option.Boolean('--no-fail')

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
    const endTime = new Date()
    const exitCode: number = status ?? this.signalToNumber(signal) ?? BAD_COMMAND_EXIT_CODE
    const commandStr = this.command.join(' ')

    const res = await this.executeReportCustomSpan(id, startTime, endTime, {
      command: commandStr,
      name: this.name ?? commandStr,
      error_message: stderr,
      exit_code: exitCode,
    })

    if (res !== 0) {
      if (this.noFail) {
        console.log('note: Not failing since --no-fail provided')

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
