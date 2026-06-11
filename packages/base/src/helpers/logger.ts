import chalk from 'chalk'

export enum LogLevel {
  DEBUG = 1,
  INFO,
  WARN,
  ERROR,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
}

export interface LoggerOptions {
  shouldIncludeTimestamp?: boolean
  /**
   * When `true`, every log call emits a single-line JSON object instead of
   * ANSI-coloured text. Useful when Datadog itself (or any other log
   * pipeline) ingests CLI output: each line parses cleanly and `level` is
   * preserved instead of every `error` showing up as `info`.
   */
  jsonOutput?: boolean
}

export class Logger {
  private loglevel: LogLevel
  private rawWriteMessage: (s: string) => void
  private shouldIncludeTimestamp: boolean
  private jsonOutput: boolean

  constructor(
    writeMessage: (s: string) => void,
    loglevel: LogLevel,
    shouldIncludeTimestampOrOptions?: boolean | LoggerOptions
  ) {
    const options: LoggerOptions =
      typeof shouldIncludeTimestampOrOptions === 'boolean'
        ? {shouldIncludeTimestamp: shouldIncludeTimestampOrOptions}
        : (shouldIncludeTimestampOrOptions ?? {})

    this.rawWriteMessage = writeMessage
    this.shouldIncludeTimestamp = options.shouldIncludeTimestamp ?? false
    this.jsonOutput = options.jsonOutput ?? false
    this.loglevel = loglevel
  }

  public setLogLevel(newLogLevel: LogLevel) {
    this.loglevel = newLogLevel
  }

  public setShouldIncludeTime(newShouldIncludeTimestamp: boolean) {
    this.shouldIncludeTimestamp = newShouldIncludeTimestamp
  }

  public setJsonOutput(newJsonOutput: boolean) {
    this.jsonOutput = newJsonOutput
  }

  public error(s: string) {
    if (this.loglevel <= LogLevel.ERROR) {
      this.emit(LogLevel.ERROR, s, chalk.red)
    }
  }

  public warn(s: string) {
    if (this.loglevel <= LogLevel.WARN) {
      this.emit(LogLevel.WARN, s, chalk.yellow)
    }
  }

  public info(s: string) {
    if (this.loglevel <= LogLevel.INFO) {
      this.emit(LogLevel.INFO, s)
    }
  }

  public debug(s: string) {
    if (this.loglevel <= LogLevel.DEBUG) {
      this.emit(LogLevel.DEBUG, s)
    }
  }

  private emit(level: LogLevel, message: string, colorize?: (s: string) => string) {
    if (this.jsonOutput) {
      const payload: Record<string, string> = {
        level: LEVEL_NAMES[level],
        message,
      }
      if (this.shouldIncludeTimestamp) {
        payload.timestamp = new Date().toISOString()
      }
      this.rawWriteMessage(JSON.stringify(payload) + '\n')

      return
    }

    const prefix = this.shouldIncludeTimestamp ? `${new Date().toISOString()}: ` : ''
    const body = colorize ? colorize(message) : message
    this.rawWriteMessage(prefix + body + '\n')
  }
}
