import {Logger, LogLevel} from '../logger'

describe('Logger', () => {
  const collect = () => {
    const lines: string[] = []
    const write = (s: string) => {
      lines.push(s)
    }

    return {lines, write}
  }

  describe('text mode (default)', () => {
    it('writes each level with a trailing newline', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.DEBUG)

      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')

      expect(lines).toHaveLength(4)
      expect(lines.every((line) => line.endsWith('\n'))).toBe(true)
    })

    it('respects the configured log level', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.WARN)

      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')

      expect(lines).toHaveLength(2)
    })

    it('prefixes lines with an ISO timestamp when enabled (legacy boolean)', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.INFO, true)

      logger.info('hello')

      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.+: hello\n$/)
    })

    it('accepts the options-bag form for the timestamp flag', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.INFO, {shouldIncludeTimestamp: true})

      logger.info('hello')

      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.+: hello\n$/)
    })
  })

  describe('JSON mode', () => {
    it('emits a single-line JSON object per call with the correct level', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.DEBUG, {jsonOutput: true})

      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')

      expect(lines).toHaveLength(4)

      const parsed = lines.map((line) => {
        expect(line.endsWith('\n')).toBe(true)

        return JSON.parse(line.trim()) as Record<string, string>
      })

      expect(parsed.map((entry) => entry.level)).toEqual(['debug', 'info', 'warn', 'error'])
      expect(parsed.map((entry) => entry.message)).toEqual(['d', 'i', 'w', 'e'])
    })

    it('does not apply ANSI colour codes to JSON output', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.ERROR, {jsonOutput: true})

      logger.error('boom')

      const entry = JSON.parse(lines[0].trim()) as Record<string, string>
      expect(entry.message).toBe('boom')
      // eslint-disable-next-line no-control-regex
      expect(lines[0]).not.toMatch(/\[/)
    })

    it('includes an ISO timestamp field when timestamps are enabled', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.INFO, {jsonOutput: true, shouldIncludeTimestamp: true})

      logger.info('hello')

      const entry = JSON.parse(lines[0].trim()) as Record<string, string>
      expect(entry.message).toBe('hello')
      expect(entry.level).toBe('info')
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('omits the timestamp field when timestamps are disabled', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.INFO, {jsonOutput: true})

      logger.info('hello')

      const entry = JSON.parse(lines[0].trim()) as Record<string, string>
      expect(entry.timestamp).toBeUndefined()
    })

    it('toggles back to text via setJsonOutput(false)', () => {
      const {lines, write} = collect()
      const logger = new Logger(write, LogLevel.INFO, {jsonOutput: true})

      logger.info('json')
      logger.setJsonOutput(false)
      logger.info('plain')

      expect(() => JSON.parse(lines[0].trim())).not.toThrow()
      expect(() => JSON.parse(lines[1].trim())).toThrow()
    })
  })
})
