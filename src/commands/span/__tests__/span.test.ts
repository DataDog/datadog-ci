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

  // TODO: Backport these tests
  describe('execute', () => {
    test('ci_provider', async () => {
      // The provider is gitlab since GITLAB_CI is set in runCLI
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
    test('time', async () => {
      const env = {GITLAB_CI: '1'}
      const {context, code} = await runCLI(['--name', 'mytestname', '--start-time', '42', '--end-time', '618'], env)
      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('"start_time":"1970-01-01T00:00:00.042Z"')
      expect(context.stdout.toString()).toContain('"end_time":"1970-01-01T00:00:00.618Z"')
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

  // TODO: Backport these tests
  // describe('execute', () => {
  //   test('should fail if no CI is detected', async () => {
  //     process.env = {}
  //     const {context, code} = await runCLI([])
  //     expect(code).toBe(1)
  //     expect(context.stdout.toString()).toContain('Unsupported CI provider "unknown"')
  //   })
  //   test('should succeed if no CI is detected but --no-fail is set', async () => {
  //     process.env = {}
  //     const {code} = await runCLI(['--no-fail'])
  //     expect(code).toBe(0)
  //   })
  //   test('should detect the circleci environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       CIRCLECI: 'true',
  //       CIRCLE_WORKFLOW_ID: 'test',
  //       CIRCLE_BUILD_NUM: '10',
  //       NON_CIRCLE_ENV: 'bar',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"CIRCLE_WORKFLOW_ID\\":\\"test\\"')
  //     expect(dryRunOutput).toContain('\\"CIRCLE_BUILD_NUM\\":\\"10\\"')
  //   })
  //   test('should detect the jenkins environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       DD_CUSTOM_TRACE_ID: 'abc',
  //       DD_CUSTOM_PARENT_ID: 'xyz',
  //       JENKINS_HOME: '/root',
  //       JENKINS_URL: 'http://jenkins',
  //       NON_JENKINS_ENV: 'bar',
  //       WORKSPACE: 'def',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"DD_CUSTOM_TRACE_ID\\":\\"abc\\"')
  //     expect(dryRunOutput).toContain('\\"DD_CUSTOM_PARENT_ID\\":\\"xyz\\"')
  //   })
  //   test('should detect the github environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       GITHUB_ACTIONS: 'true',
  //       GITHUB_SERVER_URL: 'http://github',
  //       GITHUB_REPOSITORY: 'test/test',
  //       GITHUB_RUN_ID: '10',
  //       GITHUB_RUN_ATTEMPT: '1',
  //       GITHUB_JOB: 'jobname',
  //       DD_GITHUB_JOB_NAME: 'custom_jobname',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"GITHUB_SERVER_URL\\":\\"http://github\\"')
  //     expect(dryRunOutput).toContain('\\"GITHUB_REPOSITORY\\":\\"test/test\\"')
  //     expect(dryRunOutput).toContain('\\"GITHUB_RUN_ID\\":\\"10\\"')
  //     expect(dryRunOutput).toContain('\\"GITHUB_RUN_ATTEMPT\\":\\"1\\"')
  //     expect(dryRunOutput).toContain('\\"DD_GITHUB_JOB_NAME\\":\\"custom_jobname\\"')
  //     expect(dryRunOutput).toContain('"ci.job.name":"jobname"')
  //   })
  //   test('should detect the gitlab environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       GITLAB_CI: 'true',
  //       CI_PROJECT_URL: 'http://gitlab',
  //       CI_PIPELINE_ID: '10',
  //       CI_JOB_ID: '50',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"CI_PROJECT_URL\\":\\"http://gitlab\\"')
  //     expect(dryRunOutput).toContain('\\"CI_PIPELINE_ID\\":\\"10\\"')
  //     expect(dryRunOutput).toContain('\\"CI_JOB_ID\\":\\"50\\"')
  //   })
  //   test('should detect the azure environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       TF_BUILD: 'true',
  //       SYSTEM_TEAMPROJECTID: 'test',
  //       BUILD_BUILDID: '10',
  //       SYSTEM_JOBID: '3acfg',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"SYSTEM_TEAMPROJECTID\\":\\"test\\"')
  //     expect(dryRunOutput).toContain('\\"BUILD_BUILDID\\":\\"10\\"')
  //     expect(dryRunOutput).toContain('\\"SYSTEM_JOBID\\":\\"3acfg\\"')
  //   })
  //   test('should detect the aws codepipeline environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       CODEBUILD_INITIATOR: 'codepipeline-abc',
  //       DD_PIPELINE_EXECUTION_ID: 'def-234',
  //       CODEBUILD_BUILD_ARN: 'arn:aws:codebuild:us-west-2:123456789012:build/MyProjectName:6a8f0d8a',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"DD_PIPELINE_EXECUTION_ID\\":\\"def-234\\"')
  //     expect(dryRunOutput).toContain(
  //       '\\"CODEBUILD_BUILD_ARN\\":\\"arn:aws:codebuild:us-west-2:123456789012:build/MyProjectName:6a8f0d8a\\"'
  //     )
  //   })
  //   test('should detect the buildkite environment', async () => {
  //     const {context, code} = await runCLI([], {
  //       BUILDKITE: 'true',
  //       BUILDKITE_BUILD_ID: 'abc',
  //       BUILDKITE_JOB_ID: 'def',
  //     })
  //     expect(code).toBe(0)
  //     const dryRunOutput = context.stdout.toString()
  //     expect(dryRunOutput).toContain('\\"BUILDKITE_BUILD_ID\\":\\"abc\\"')
  //     expect(dryRunOutput).toContain('\\"BUILDKITE_JOB_ID\\":\\"def\\"')
  //   })
  // })
})
