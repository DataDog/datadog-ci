import {Command, Option} from 'clipanion'

import * as validation from '@datadog/datadog-ci-base/helpers/validation'

import {CustomSpanCommand} from '../trace/helper'

export class SpanCommand extends CustomSpanCommand {
  public static paths = [['trace', 'span']]

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
        'datadog-ci trace span --name "Get Dependencies" --duration 10000',
      ],
      [
        'Create span with name "Build" and duration of 10s using timestamps and report to Datadog',
        'datadog-ci trace span --name "Build" --start-time 1744357891967 --end-time 1744357901967',
      ],
      [
        'Create span with name "Get Dependencies" and duration of 10s and report to Datadog with tags and measures',
        'datadog-ci trace span --name "Get Dependencies" --duration 10000 --tags "dependency-set:notify" --measures "n-dependencies:42"',
      ],
      [
        'Create a span nested under another custom span by referencing its span ID',
        'datadog-ci trace span --name "Plan" --duration 10000 --span-id 0a1b2c3d4e --parent-id 5f6a7b8c9d',
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
  // Optional explicit IDs so callers can assemble a span tree.
  private spanId = Option.String('--span-id')
  private parentId = Option.String('--parent-id')

  public async execute() {
    this.tryEnableFips()

    if (!this.name) {
      this.context.stderr.write(`The span name must be provided.\n`)

      return 1
    }

    if (
      (this.startTimeInMs && !this.endTimeInMs) ||
      (!this.startTimeInMs && this.endTimeInMs) ||
      (this.durationInMs && (this.startTimeInMs || this.endTimeInMs))
    ) {
      this.context.stderr.write(`Either duration or start and end time must be provided.\n`)

      return 1
    }

    if (this.startTimeInMs && this.endTimeInMs) {
      this.durationInMs = this.endTimeInMs - this.startTimeInMs
    }

    if (!this.durationInMs) {
      this.context.stderr.write(`The span duration must be provided or start-time and end-time.\n`)

      return 1
    }

    if (this.durationInMs < 0) {
      this.context.stderr.write(`The span duration must be positive / end time must be after start time.\n`)

      return 1
    }

    const hexPattern = /^[0-9a-f]+$/i
    if (this.spanId !== undefined && !hexPattern.test(this.spanId)) {
      this.context.stderr.write(`The span ID must be a hexadecimal string.\n`)

      return 1
    }
    if (this.parentId !== undefined && !hexPattern.test(this.parentId)) {
      this.context.stderr.write(`The parent ID must be a hexadecimal string.\n`)

      return 1
    }

    const endTime = this.endTimeInMs ? new Date(this.endTimeInMs) : new Date()
    const startTime = new Date(endTime.getTime() - this.durationInMs)

    return this.executeReportCustomSpan(
      this.spanId ?? this.generateSpanId(),
      startTime,
      endTime,
      {
        name: this.name,
        error_message: '',
        exit_code: 0,
        command: 'datadog-ci trace span',
      },
      this.parentId
    )
  }
}
