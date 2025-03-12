/* eslint-disable no-null/no-null */
import {PassThrough} from 'stream'

import {Cli} from 'clipanion/lib/advanced'

import {createMockContext} from '../../../helpers/__tests__/fixtures'

import {TraceCommand} from '../trace'
import {makeCIProviderTests} from './utils'

describe('trace', () => {
  const runCLI = async (extraArgs: string[], extraEnv?: Record<string, string>) => {
    const cli = new Cli()
    cli.register(TraceCommand)
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER', ...extraEnv}
    context.env = process.env
    context.stderr = new PassThrough()
    const code = await cli.run(['trace', '--dry-run', ...extraArgs, '--', 'echo'], context)

    return {context, code}
  }

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

  makeCIProviderTests(runCLI, [])();
})
