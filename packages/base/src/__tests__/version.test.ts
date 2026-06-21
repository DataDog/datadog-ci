import {Logger, LogLevel} from '../helpers/logger'
import {cliVersion, printVersion} from '../version'

describe('printVersion', () => {
  const collect = (jsonOutput: boolean) => {
    const lines: string[] = []
    const logger = new Logger((s) => lines.push(s), LogLevel.INFO, {jsonOutput})

    return {lines, logger}
  }

  it('emits the banner as a JSON line in JSON mode', () => {
    const {lines, logger} = collect(true)

    printVersion(logger)

    expect(JSON.parse(lines[0])).toEqual({level: 'info', message: `datadog-ci v${cliVersion}`})
  })

  it('emits a dim text banner in text mode', () => {
    const {lines, logger} = collect(false)

    printVersion(logger)

    expect(lines[0]).toContain(`datadog-ci v${cliVersion}`)
    expect(() => JSON.parse(lines[0])).toThrow()
  })

  it('does not print for the version command', () => {
    const original = process.argv
    process.argv = ['node', 'datadog-ci', 'version']

    try {
      const {lines, logger} = collect(false)
      printVersion(logger)
      expect(lines).toHaveLength(0)
    } finally {
      process.argv = original
    }
  })
})
