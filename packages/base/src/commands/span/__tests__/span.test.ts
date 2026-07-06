/* eslint-disable no-null/no-null */

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {makeCIProviderTests} from '../../trace/test-utils'

import {SpanCommand} from '../span'

describe('span', () => {
  const runCLI = makeRunCLI(SpanCommand, ['trace', 'span', '--dry-run'])

  describe('execute', () => {
    afterEach(() => {
      jest.resetAllMocks()
    })

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
      const {context, code} = await runCLI(['--duration', '10000'], env)
      expect(code).toBe(1)
      // Validation errors are diagnostics: they belong on stderr, not stdout (which must stay
      // clean for `$(datadog-ci trace span ...)` captures).
      expect(context.stderr.toString()).toContain('The span name must be provided.')
      expect(context.stdout.toString()).toBe('')
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
      const {code} = await runCLI(
        ['--name', 'mytestname', '--start-time', '42', '--end-time', '618', '--duration', '1618'],
        env
      )
      expect(code).toBe(1)
    })

    test('time-reverse', async () => {
      const env = {GITLAB_CI: '1'}
      const {code} = await runCLI(['--name', 'mytestname', '--start-time', '618', '--end-time', '42'], env)
      expect(code).toBe(1)
    })

    test('tags', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--tags', 'hello:world', '--duration', '10000'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"hello":"world"')
    })

    test('tags-multiple', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--tags', 'hello:world', '--tags', 'super:mario', '--duration', '10000'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"hello":"world"')
      expect(context.stdout.toString()).toContain('"super":"mario"')
    })

    test('measures', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--measures', 'life:42', '--duration', '10000'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"life":42')
    })

    test('measures-multiple', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--measures', 'life:42', '--measures', 'golden:1.618', '--duration', '10000'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"life":42')
      expect(context.stdout.toString()).toContain('"golden":1.618')
    })

    test('span-id', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--duration', '10000', '--span-id', '0a1b2c3d4e'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"span_id":"0a1b2c3d4e"')
    })

    test('parent-id', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(
        ['--name', 'mytestname', '--duration', '10000', '--span-id', '0a1b2c3d4e', '--parent-id', '5f6a7b8c9d'],
        env
      )
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"span_id":"0a1b2c3d4e"')
      expect(context.stdout.toString()).toContain('"parent_id":"5f6a7b8c9d"')
    })

    test('no-parent-id-by-default', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--duration', '10000'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).not.toContain('"parent_id"')
    })

    test('span-id-invalid', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--duration', '10000', '--span-id', 'xyz'], env)
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('The span ID must be a hexadecimal string.')
    })

    test('parent-id-invalid', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--duration', '10000', '--parent-id', 'xyz'], env)
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('The parent ID must be a hexadecimal string.')
    })
  })

  makeCIProviderTests(runCLI, ['--name', 'mytestname', '--duration', '10000'])
})
