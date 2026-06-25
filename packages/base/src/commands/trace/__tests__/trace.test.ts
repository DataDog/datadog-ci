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
    context.stderr = new PassThrough()
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
  })

  describe('no-capture', () => {
    // Runs `trace` (in --dry-run) with a full command line including arguments, and returns the
    // custom span payload that would have been reported (emitted to stdout by --dry-run).
    const runWithCommand = async (extraArgs: string[], command: string[]) => {
      const cli = new Cli()
      cli.register(TraceCommand)

      process.env = {...getEnvVarPlaceholders(), CIRCLECI: 'true'}
      const context = createMockContext({env: process.env})
      context.stderr = new PassThrough()
      const code = await cli.run(['trace', '--dry-run', ...extraArgs, '--', ...command], context)

      const stdout = context.stdout.toString()
      const match = stdout.match(/Reporting custom span: (\{.*\})/)
      const payload = match ? JSON.parse(match[1]) : undefined

      return {code, payload}
    }

    test('captures the full command line by default', async () => {
      const {payload} = await runWithCommand([], ['echo', '--token', 'secret'])
      expect(payload.command).toBe('echo --token secret')
      expect(payload.name).toBe('echo --token secret')
    })

    test('reports only the executable name with --no-capture', async () => {
      const {payload} = await runWithCommand(['--no-capture'], ['echo', '--token', 'secret'])
      expect(payload.command).toBe('echo')
      expect(payload.name).toBe('echo')
    })

    test('still honors an explicit --name with --no-capture', async () => {
      const {payload} = await runWithCommand(['--no-capture', '--name', 'Deploy'], ['echo', '--token', 'secret'])
      expect(payload.command).toBe('echo')
      expect(payload.name).toBe('Deploy')
    })
  })

  makeCIProviderTests(runCLI, [])
})
