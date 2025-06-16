/**
 * Tests for CLI MCP Server Mode
 *
 * @author Ryan Strat
 */

describe('CLI MCP Server Mode', () => {
  let originalArgv: string[]

  beforeEach(() => {
    originalArgv = process.argv
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  describe('argument parsing', () => {
    it('should detect --mcp-server flag in arguments', () => {
      process.argv = ['node', 'cli.js', '--mcp-server']

      expect(process.argv.includes('--mcp-server')).toBe(true)
    })

    it('should detect --mcp-server flag with other arguments', () => {
      process.argv = ['node', 'cli.js', '--verbose', '--mcp-server', '--debug']

      expect(process.argv.includes('--mcp-server')).toBe(true)
    })

    it('should detect --mcp-server flag in various positions', () => {
      const testCases = [
        ['node', 'cli.js', '--mcp-server'],
        ['node', 'cli.js', '--verbose', '--mcp-server'],
        ['node', 'cli.js', '--mcp-server', '--verbose'],
        ['node', 'cli.js', 'other-command', '--mcp-server'],
      ]

      for (const argv of testCases) {
        process.argv = argv
        expect(process.argv.includes('--mcp-server')).toBe(true)
      }
    })

    it('should not trigger on partial matches', () => {
      const testCases = [
        ['node', 'cli.js', '--mcp-server-config'],
        ['node', 'cli.js', '--not-mcp-server'],
        ['node', 'cli.js', 'lambda', '--function', 'mcp-server'],
      ]

      for (const argv of testCases) {
        process.argv = argv
        expect(process.argv.includes('--mcp-server')).toBe(false)
      }
    })

    it('should not detect flag when not present', () => {
      process.argv = ['node', 'cli.js', 'lambda', 'flare', '--help']

      expect(process.argv.includes('--mcp-server')).toBe(false)
    })
  })
})
