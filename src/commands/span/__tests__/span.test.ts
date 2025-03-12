/* eslint-disable no-null/no-null */
import {PassThrough} from 'stream'

import {Cli} from 'clipanion/lib/advanced'

import {createMockContext} from '../../../helpers/__tests__/fixtures'

import {SpanCommand} from '../span'
import {makeCIProviderTests} from '../../trace/__tests__/utils'

describe('span', () => {
  const runCLI = async (extraArgs: string[], extraEnv?: Record<string, string>) => {
    const cli = new Cli()
    cli.register(SpanCommand)
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER', ...extraEnv}
    context.env = process.env
    context.stderr = new PassThrough()
    const code = await cli.run(['span', '--dry-run', ...extraArgs], context)

    return {context, code}
  }

  describe('execute', () => {
    test('ci_provider', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"ci_provider":"gitlab"')
    })
    test('name', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"name":"mytestname"')
    })
    test('no-name', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--duration', '10000'], env)
      expect(code).toBe(1)
    })
    test('no-time-info', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname'], env)
      expect(code).toBe(1)
    })
    test('time', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--start-time', '42', '--end-time', '618'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"start_time":"1970-01-01T00:00:00.042Z"')
      expect(context.stdout.toString()).toContain('"end_time":"1970-01-01T00:00:00.618Z"')
    })
    test('time-only-start', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname', '--start-time', '42'], env)
      expect(code).toBe(1)
    })
    test('time-only-end', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname', '--end-time', '618'], env)
      expect(code).toBe(1)
    })
    test('time-and-duration', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname', '--start-time', '42', '--end-time', '618', '--duration', '1618'], env)
      expect(code).toBe(1)
    })
    test('time-reverse', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname', '--start-time', '618', '--end-time', '42'], env)
      expect(code).toBe(1)
    })
    test('tags', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--tags', 'hello:world', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"hello":"world"')
    })
    test('tags-multiple', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--tags', 'hello:world', '--tags', 'super:mario', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"hello":"world"')
      expect(context.stdout.toString()).toContain('"super":"mario"')
    })
    test('measures', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--measures', 'life:42', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"life":42')
    })
    test('measures-multiple', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--measures', 'life:42', '--measures', 'golden:1.618', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"life":42')
      expect(context.stdout.toString()).toContain('"golden":1.618')
    })
  })

  makeCIProviderTests(runCLI, ['--name', 'mytestname', '--duration', '10000'])()
})
