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
import { CustomSpanCommand } from './helper'

export class SpanCommand extends CustomSpanCommand {
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

  public async execute() {
    if (!this.name) {
      this.context.stdout.write(
        `The span name must be provided.\n`
      )
      return 1;
    }

    if (this.startTimeInMs && !this.endTimeInMs || !this.startTimeInMs && this.endTimeInMs || this.durationInMs && (this.startTimeInMs || this.endTimeInMs)) {
      this.context.stdout.write(
        `Either duration or start and end time must be provided.\n`
      )
      return 1;
    }

    if (this.startTimeInMs && this.endTimeInMs) {
      this.durationInMs = this.endTimeInMs - this.startTimeInMs;
    }

    if (!this.durationInMs) {
      this.context.stdout.write(
        `The span duration must be provided or start-time and end-time.\n`
      )
      return 1;
    }

    if (this.durationInMs < 0) {
      this.context.stdout.write(
        `The span duration must be positive / end time must be after start time.\n`
      )
      return 1;
    }

    const endTime = this.endTimeInMs ? new Date(this.endTimeInMs) : new Date()
    const startTime = new Date(endTime.getTime() - this.durationInMs)

    return await this.executeReportCustomSpan(this.generateSpanId(), startTime, endTime, {
      name: this.name,
      error_message: '',
      exit_code: 0,
      command: 'custom-span',
    })
  }
}

