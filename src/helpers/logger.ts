import chalk from 'chalk'

export enum LogLevel {
  DEBUG = 1,
  INFO,
  WARN,
  ERROR,
}

export class Logger {
  private loglevel: LogLevel
  private writeMessage: (s: string) => void
  private shouldIncludeTimestamp: boolean

  constructor(writeMessage: (s: string) => void, loglevel: LogLevel, shouldIncludeTimestamp?: boolean) {
    this.shouldIncludeTimestamp = shouldIncludeTimestamp ?? false
    this.writeMessage = (s: string) => {
      const message = this.shouldIncludeTimestamp ? `${new Date().toISOString()}: ${s}` : s

      return writeMessage(message)
    }
    this.loglevel = loglevel
  }

  public setLogLevel(newLogLevel: LogLevel) {
    this.loglevel = newLogLevel
  }

  public setShouldIncludeTime(newShouldIncludeTimestamp: boolean) {
    this.shouldIncludeTimestamp = newShouldIncludeTimestamp
  }

  public error(s: string) {
    if (this.loglevel <= LogLevel.ERROR) {
      this.writeMessage(chalk.red(s) + '\n')
    }
  }

  public warn(s: string) {
    if (this.loglevel <= LogLevel.WARN) {
      this.writeMessage(chalk.yellow(s) + '\n')
    }
  }

  public info(s: string) {
    if (this.loglevel <= LogLevel.INFO) {
      this.writeMessage(s + '\n')
    }
  }

  public debug(s: string) {
    if (this.loglevel <= LogLevel.DEBUG) {
      this.writeMessage(s + '\n')
    }
  }
}
