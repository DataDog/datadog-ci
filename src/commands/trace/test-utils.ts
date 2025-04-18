// Only the function is exported, not the test such that there is no test duplication

import {makeRunCLI} from '../../helpers/__tests__/testing-tools'

type RunCLIType = ReturnType<typeof makeRunCLI>

/* eslint-disable jest/no-export */

export const makeCIProviderTests = (runCLI: RunCLIType, runCLIArgs: string[]) => {
  describe('execute', () => {
    test('should fail if no CI is detected', async () => {
      process.env = {}
      const {context, code} = await runCLI(runCLIArgs)
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Unsupported CI provider "unknown"')
    })

    test('should detect the circleci environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        CIRCLECI: 'true',
        CIRCLE_WORKFLOW_ID: 'test',
        CIRCLE_BUILD_NUM: '10',
        NON_CIRCLE_ENV: 'bar',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"CIRCLE_WORKFLOW_ID\\":\\"test\\"')
      expect(dryRunOutput).toContain('\\"CIRCLE_BUILD_NUM\\":\\"10\\"')
    })

    test('should detect the jenkins environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        DD_CUSTOM_TRACE_ID: 'abc',
        DD_CUSTOM_PARENT_ID: 'xyz',
        JENKINS_HOME: '/root',
        JENKINS_URL: 'http://jenkins',
        NON_JENKINS_ENV: 'bar',
        WORKSPACE: 'def',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"DD_CUSTOM_TRACE_ID\\":\\"abc\\"')
      expect(dryRunOutput).toContain('\\"DD_CUSTOM_PARENT_ID\\":\\"xyz\\"')
    })

    test('should detect the github environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'http://github',
        GITHUB_REPOSITORY: 'test/test',
        GITHUB_RUN_ID: '10',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'jobname',
        DD_GITHUB_JOB_NAME: 'custom_jobname',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"GITHUB_SERVER_URL\\":\\"http://github\\"')
      expect(dryRunOutput).toContain('\\"GITHUB_REPOSITORY\\":\\"test/test\\"')
      expect(dryRunOutput).toContain('\\"GITHUB_RUN_ID\\":\\"10\\"')
      expect(dryRunOutput).toContain('\\"GITHUB_RUN_ATTEMPT\\":\\"1\\"')
      expect(dryRunOutput).toContain('\\"DD_GITHUB_JOB_NAME\\":\\"custom_jobname\\"')
      expect(dryRunOutput).toContain('"ci.job.name":"jobname"')
    })

    test('should detect the gitlab environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        GITLAB_CI: 'true',
        CI_PROJECT_URL: 'http://gitlab',
        CI_PIPELINE_ID: '10',
        CI_JOB_ID: '50',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"CI_PROJECT_URL\\":\\"http://gitlab\\"')
      expect(dryRunOutput).toContain('\\"CI_PIPELINE_ID\\":\\"10\\"')
      expect(dryRunOutput).toContain('\\"CI_JOB_ID\\":\\"50\\"')
    })

    test('should detect the azure environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        TF_BUILD: 'true',
        SYSTEM_TEAMPROJECTID: 'test',
        BUILD_BUILDID: '10',
        SYSTEM_JOBID: '3acfg',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"SYSTEM_TEAMPROJECTID\\":\\"test\\"')
      expect(dryRunOutput).toContain('\\"BUILD_BUILDID\\":\\"10\\"')
      expect(dryRunOutput).toContain('\\"SYSTEM_JOBID\\":\\"3acfg\\"')
    })

    test('should detect the aws codepipeline environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        CODEBUILD_INITIATOR: 'codepipeline-abc',
        DD_PIPELINE_EXECUTION_ID: 'def-234',
        CODEBUILD_BUILD_ARN: 'arn:aws:codebuild:us-west-2:123456789012:build/MyProjectName:6a8f0d8a',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"DD_PIPELINE_EXECUTION_ID\\":\\"def-234\\"')
      expect(dryRunOutput).toContain(
        '\\"CODEBUILD_BUILD_ARN\\":\\"arn:aws:codebuild:us-west-2:123456789012:build/MyProjectName:6a8f0d8a\\"'
      )
    })

    test('should detect the buildkite environment', async () => {
      const {context, code} = await runCLI(runCLIArgs, {
        BUILDKITE: 'true',
        BUILDKITE_BUILD_ID: 'abc',
        BUILDKITE_JOB_ID: 'def',
      })
      expect(code).toBe(0)
      const dryRunOutput = context.stdout.toString()
      expect(dryRunOutput).toContain('\\"BUILDKITE_BUILD_ID\\":\\"abc\\"')
      expect(dryRunOutput).toContain('\\"BUILDKITE_JOB_ID\\":\\"def\\"')
    })
  })
}
