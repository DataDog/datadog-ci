import {BaseCommand} from '..'
import {LOG_FORMAT_ENV_VAR} from '../constants'
import {makeRunCLI} from '../helpers/__tests__/testing-tools'

class LoggingCommand extends BaseCommand {
  public static paths = [['logging-test']]

  public async execute(): Promise<number> {
    this.logger.info('hello')
    this.logger.warn('careful')
    this.logger.error('boom')

    return 0
  }
}

describe('BaseCommand --log-format', () => {
  const runCLI = makeRunCLI(LoggingCommand, ['logging-test'])

  it('defaults to text output', async () => {
    const {context, code} = await runCLI([])

    expect(code).toBe(0)
    const out = context.stdout.toString()
    expect(() => JSON.parse(out.split('\n')[0])).toThrow()
    expect(out).toContain('hello')
  })

  it('emits one JSON object per log line with the correct level when --log-format json', async () => {
    const {context, code} = await runCLI(['--log-format', 'json'])

    expect(code).toBe(0)
    const lines = context.stdout
      .toString()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, string>)

    expect(lines.map((entry) => entry.level)).toEqual(['info', 'warn', 'error'])
    expect(lines.map((entry) => entry.message)).toEqual(['hello', 'careful', 'boom'])
  })

  it('reads the format from the DD_LOG_FORMAT environment variable', async () => {
    const {context, code} = await runCLI([], {[LOG_FORMAT_ENV_VAR]: 'json'})

    expect(code).toBe(0)
    const firstLine = context.stdout.toString().split('\n')[0]
    expect(JSON.parse(firstLine)).toMatchObject({level: 'info', message: 'hello'})
  })

  it('lets the CLI flag take precedence over the environment variable', async () => {
    const {context, code} = await runCLI(['--log-format', 'text'], {[LOG_FORMAT_ENV_VAR]: 'json'})

    expect(code).toBe(0)
    expect(() => JSON.parse(context.stdout.toString().split('\n')[0])).toThrow()
  })

  it('fails with a clear error on an invalid format', async () => {
    const {context, code} = await runCLI(['--log-format', 'yaml'])

    expect(code).not.toBe(0)
    expect(context.stdout.toString()).toContain('Invalid value for --log-format')
  })
})
