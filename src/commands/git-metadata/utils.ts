import chalk from 'chalk'

export const timedExecAsync = async <I, O>(f: (input: I) => Promise<O>, input: I): Promise<number> => {
  const initialTime = Date.now()
  await f(input)
  return (Date.now() - initialTime) / 1000
}

export enum LogLevel {
  DEBUG = 1,
  INFO,
  WARN,
  ERROR,
}

export class Logger {
  private loglevel: LogLevel
  private writeMessage: (s: string) => void

  constructor(writeMessage: (s: string) => void, loglevel: LogLevel) {
    this.writeMessage = writeMessage
    this.loglevel = loglevel
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
