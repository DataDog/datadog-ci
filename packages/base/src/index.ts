import type {BaseContext} from 'clipanion'

import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {LOG_FORMAT_ENV_VAR} from './constants'
import {Logger, LogLevel} from './helpers/logger'

export type CommandContext = BaseContext & {
  builtinPlugins: string[]
}

/**
 * This command should be extended by **every** command in the monorepo.
 */
export abstract class BaseCommand extends Command<CommandContext> {
  // Hidden while the JSON logging migration is in progress: most commands do not
  // honour it yet. Unhide once coverage is broad enough.
  // Resolution order (handled by clipanion): CLI flag > DD_LOG_FORMAT env var > default.
  protected logFormat = Option.String('--log-format', 'text', {
    env: LOG_FORMAT_ENV_VAR,
    hidden: true,
    description: "Output format for logs: 'text' (default) or 'json' (one JSON object per line).",
    validator: t.isEnum(['text', 'json'] as const),
  })

  private _logger?: Logger

  public get logger(): Logger {
    if (!this._logger) {
      // The sanctioned sink: this is the single place allowed to write to the raw stream.
      // eslint-disable-next-line no-restricted-syntax
      this._logger = new Logger((s) => this.context.stdout.write(s), LogLevel.INFO, {
        jsonOutput: this.logFormat === 'json',
      })
    }

    return this._logger
  }
}
