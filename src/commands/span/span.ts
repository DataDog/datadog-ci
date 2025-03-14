import fs from 'fs'

import {Command, Option} from 'clipanion'

import * as validation from '../../helpers/validation'

import {CustomSpanCommand} from '../trace/helper'

interface SpanArgs {
  name: string | undefined
  durationInMs: number | undefined
  startTimeInMs: number | undefined
  endTimeInMs: number | undefined
  tags: string[] | undefined
  measures: string[] | undefined
}

export class SpanCommand extends CustomSpanCommand {
  public static paths = [['span']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Report a custom span to Datadog with name, start / end time or duration, tags and measures.',
    details: `
      This command reports a span with custom name and custom duration to Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Create span with name "Get Dependencies" and duration of 10s and report to Datadog',
        'datadog-ci span --name "Get Dependencies" --duration 10000',
      ],
      [
        'Create span with name "Get Dependencies" and duration of 10s and report to Datadog with tags and measures',
        'datadog-ci span --name "Get Dependencies" --duration 10000 --tags "dependency-set:notify" --measures "n-dependencies:42"',
      ],
    ],
  })

  private name = Option.String('--name')
  private durationInMs: number | undefined = Option.String('--duration', {
    validator: validation.isInteger(),
  })
  private startTimeInMs: number | undefined = Option.String('--start-time', {
    validator: validation.isInteger(),
  })
  private endTimeInMs: number | undefined = Option.String('--end-time', {
    validator: validation.isInteger(),
  })
  private payloadFile = Option.String('--payload-file')

  public async execute() {
    this.tryEnableFips()

    if (this.payloadFile) {
      // Read json
      const content = fs.readFileSync(this.payloadFile, 'utf-8')?.toString()
      if (!content) {
        this.context.stdout.write(`Error reading payload file ${this.payloadFile}\n`)

        return 1
      }

      const payload = JSON.parse(content)
      if (!payload) {
        this.context.stdout.write(`Error parsing payload file ${this.payloadFile}\n`)

        return 1
      }

      if (!Array.isArray(payload)) {
        this.context.stdout.write(`Payload file ${this.payloadFile} must contain an array of span args\n`)

        return 1
      }

      let exitCode = 0
      for (const spanArgs of payload) {
        const code = await this.reportSpan(spanArgs)
        if (code !== 0) {
          exitCode = code
          this.context.stdout.write(`Error reporting span: ${JSON.stringify(spanArgs)}\n`)
        }
      }

      return exitCode
    } else {
      return this.reportSpan({
        name: this.name,
        durationInMs: this.durationInMs,
        startTimeInMs: this.startTimeInMs,
        endTimeInMs: this.endTimeInMs,
        tags: this.tags,
        measures: this.measures,
      })
    }
  }

  private async reportSpan(args: SpanArgs) {
    if (!args.name) {
      this.context.stdout.write(`The span name must be provided.\n`)

      return 1
    }

    if (
      (args.startTimeInMs && !args.endTimeInMs) ||
      (!args.startTimeInMs && args.endTimeInMs) ||
      (args.durationInMs && (args.startTimeInMs || args.endTimeInMs))
    ) {
      this.context.stdout.write(`Either duration or start and end time must be provided.\n`)

      return 1
    }

    let durationInMs = args.durationInMs
    if (args.startTimeInMs && args.endTimeInMs) {
      durationInMs = args.endTimeInMs - args.startTimeInMs
    }

    if (durationInMs === undefined) {
      this.context.stdout.write(`The span duration must be provided or start-time and end-time.\n`)

      return 1
    }

    if (durationInMs < 0) {
      this.context.stdout.write(`The span duration must be positive / end time must be after start time.\n`)

      return 1
    } else if (durationInMs === 0) {
      // At least 1ms duration
      durationInMs = 1
    }

    const endTime = args.endTimeInMs ? new Date(args.endTimeInMs) : new Date()
    const startTime = new Date(endTime.getTime() - durationInMs)

    return this.executeReportCustomSpan(this.generateSpanId(), startTime, endTime, args.tags, args.measures, {
      name: args.name,
      error_message: '',
      exit_code: 0,
      command: 'custom-span',
    })
  }
}
