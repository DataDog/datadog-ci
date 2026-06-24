/* eslint-disable no-null/no-null */
import {PassThrough} from 'stream'

import {Cli} from 'clipanion'

import {createMockContext, getEnvVarPlaceholders} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {makeCIProviderTests} from '../test-utils'
import {TraceCommand} from '../trace'

describe('trace', () => {
  const runCLI = async (extraArgs: string[], extraEnv?: Record<string, string>) => {
    const cli = new Cli()
    cli.register(TraceCommand)

    process.env = {...getEnvVarPlaceholders(), ...extraEnv}
    const context = createMockContext({env: process.env})
    // `trace` pipes the child's stderr into `context.stderr` (`childProcess.stderr.pipe(...)`),
    // which needs a real stream — the mock context's stderr isn't one. Use a PassThrough, but
    // wrap `write` so we can still synchronously assert on what the command emits to stderr.
    const stderr = new PassThrough()
    let stderrData = ''
    const originalWrite = stderr.write.bind(stderr)
    stderr.write = ((chunk: any, ...rest: any[]) => {
      stderrData += chunk.toString()

      return originalWrite(chunk, ...rest)
    }) as typeof stderr.write
    ;(stderr as any).toString = () => stderrData
    context.stderr = stderr
    const code = await cli.run(['trace', '--dry-run', ...extraArgs, '--', 'echo'], context)

    return {context, code}
  }

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('signalToNumber', () => {
    test('should map null to undefined', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber'](null)).toBeUndefined()
    })

    test('should map SIGKILL to 137', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber']('SIGKILL')).toEqual(128 + 9)
    })
  })

  describe('executeNoFail', () => {
    test('should succeed if no CI is detected but --no-fail is set', async () => {
      process.env = {}
      const {code} = await runCLI(['--no-fail'])
      expect(code).toBe(0)
    })

    test('should write the --no-fail note to stderr, not stdout', async () => {
      // Regression: `trace` inherits the wrapped child's stdout, so any diagnostic the command
      // writes to its own stdout leaks into `VAR=$(datadog-ci trace -- cmd)` captures and can
      // corrupt captured values (e.g. secrets). Diagnostics must go to stderr.
      process.env = {}
      const {context, code} = await runCLI(['--no-fail'])
      expect(code).toBe(0)
      // This is the assertion that catches the bug: the old `console.log` never reached stderr.
      expect(context.stderr.toString()).toContain('note: Not failing since --no-fail provided')
      // Guards against a future `context.stdout.write` leak (the old `console.log` bypassed this mock).
      expect(context.stdout.toString()).toBe('')
    })
  })

  makeCIProviderTests(runCLI, [])
})
