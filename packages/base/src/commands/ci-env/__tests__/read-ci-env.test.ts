import {Cli} from 'clipanion'

import {createMockContext} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {ReadCiEnvCommand} from '../read-ci-env'

const makeCLI = () => {
  const cli = new Cli()
  cli.register(ReadCiEnvCommand)

  return cli
}

describe('read-ci-env', () => {
  const runCLI = async (env: Record<string, string>, format?: string) => {
    const cli = makeCLI()
    const context = createMockContext()
    const originalEnv = process.env
    process.env = {...env}

    const args = format ? ['ci-env', 'read', '--format', format] : ['ci-env', 'read']
    const code = await cli.run(args, context)

    process.env = originalEnv

    return {context, code}
  }

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('GitHub Actions', () => {
    const githubEnv = {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '12345',
      GITHUB_WORKFLOW: 'Test Workflow',
      GITHUB_RUN_NUMBER: '42',
      GITHUB_WORKSPACE: '/workspace',
      GITHUB_JOB: 'test-job',
      GITHUB_SHA: 'abc123def456',
      GITHUB_REPOSITORY: 'DataDog/test',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ATTEMPT: '1',
    }

    test('should output bash format by default', async () => {
      const {context, code} = await runCLI(githubEnv)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_JOB_NAME='test-job'")
      expect(output).toContain("DD_CI_PIPELINE_ID='12345'")
      expect(output).toContain("DD_CI_PROVIDER_NAME='github'")
      expect(output).toContain("DD_GIT_COMMIT_SHA='abc123def456'")
    })

    test('should output JSON format', async () => {
      const {context, code} = await runCLI(githubEnv, 'json')
      expect(code).toBe(0)
      const output = context.stdout.toString()
      const json = JSON.parse(output)
      expect(json.DD_CI_JOB_NAME).toBe('test-job')
      expect(json.DD_CI_PIPELINE_ID).toBe('12345')
      expect(json.DD_CI_PROVIDER_NAME).toBe('github')
      expect(json.DD_GIT_COMMIT_SHA).toBe('abc123def456')
    })

    test('should output internal tags format', async () => {
      const {context, code} = await runCLI(githubEnv, 'tags')
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('ci.job.name:"test-job"')
      expect(output).toContain('ci.job.id:"test-job"')
      expect(output).toContain('ci.pipeline.id:"12345"')
      expect(output).toContain('ci.provider.name:"github"')
      expect(output).toContain('git.commit.sha:"abc123def456"')
    })

    test('should handle special characters in bash format', async () => {
      const {context, code} = await runCLI({
        ...githubEnv,
        GITHUB_WORKFLOW: "Test's \"Workflow\" with 'quotes'",
      })
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_PIPELINE_NAME='Test'\\''s \"Workflow\" with '\\''quotes'\\'''")
    })

    test('should handle special characters in tags format', async () => {
      const {context, code} = await runCLI(
        {
          ...githubEnv,
          GITHUB_WORKFLOW: 'Test "quoted" and back\\slash',
          GITHUB_JOB: "job's name",
        },
        'tags'
      )
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('ci.pipeline.name:"Test \\"quoted\\" and back\\\\slash"')
      expect(output).toContain('ci.job.name:"job\'s name"')
    })
  })

  describe('Travis CI', () => {
    const travisEnv = {
      TRAVIS: 'true',
      TRAVIS_JOB_WEB_URL: 'https://travis-ci.org/DataDog/test/jobs/12345',
      TRAVIS_BUILD_ID: 'build123',
      TRAVIS_REPO_SLUG: 'DataDog/test',
      TRAVIS_BUILD_NUMBER: '42',
      TRAVIS_BUILD_WEB_URL: 'https://travis-ci.org/DataDog/test/builds/build123',
      TRAVIS_BUILD_DIR: '/home/travis/build',
      TRAVIS_COMMIT: 'abc123def456',
      TRAVIS_BRANCH: 'main',
    }

    test('should translate TRAVIS_JOB_WEB_URL to DD_CI_JOB_URL', async () => {
      const {context, code} = await runCLI(travisEnv)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_JOB_URL='https://travis-ci.org/DataDog/test/jobs/12345'")
      expect(output).toContain("DD_CI_PROVIDER_NAME='travisci'")
    })
  })

  describe('CircleCI', () => {
    const circleCIEnv = {
      CIRCLECI: 'true',
      CIRCLE_BUILD_NUM: '123',
      CIRCLE_WORKFLOW_ID: 'workflow-id',
      CIRCLE_PROJECT_REPONAME: 'test',
      CIRCLE_BUILD_URL: 'https://circleci.com/gh/DataDog/test/123',
      CIRCLE_JOB: 'test-job',
      CIRCLE_SHA1: 'abc123def456',
      CIRCLE_REPOSITORY_URL: 'https://github.com/DataDog/test',
      CIRCLE_BRANCH: 'main',
    }

    test('should extract CircleCI environment variables', async () => {
      const {context, code} = await runCLI(circleCIEnv)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_JOB_NAME='test-job'")
      expect(output).toContain("DD_CI_PROVIDER_NAME='circleci'")
      expect(output).toContain("DD_GIT_COMMIT_SHA='abc123def456'")
    })
  })

  describe('GitLab CI', () => {
    const gitlabEnv = {
      GITLAB_CI: 'true',
      CI_PIPELINE_ID: 'pipeline123',
      CI_PROJECT_PATH: 'DataDog/test',
      CI_PIPELINE_IID: '42',
      CI_PIPELINE_URL: 'https://gitlab.com/DataDog/test/-/pipelines/pipeline123',
      CI_JOB_NAME: 'test-job',
      CI_JOB_URL: 'https://gitlab.com/DataDog/test/-/jobs/job123',
      CI_JOB_ID: 'job123',
      CI_COMMIT_SHA: 'abc123def456',
      CI_REPOSITORY_URL: 'https://gitlab.com/DataDog/test.git',
      CI_COMMIT_REF_NAME: 'main',
    }

    test('should extract GitLab CI environment variables', async () => {
      const {context, code} = await runCLI(gitlabEnv)
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_JOB_NAME='test-job'")
      expect(output).toContain("DD_CI_PROVIDER_NAME='gitlab'")
      expect(output).toContain("DD_GIT_COMMIT_SHA='abc123def456'")
    })
  })

  describe('Error handling', () => {
    test('should fail when not in CI environment', async () => {
      const {context, code} = await runCLI({})
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('No CI environment detected')
    })

    test('should fail with invalid format', async () => {
      const {context, code} = await runCLI(
        {
          GITHUB_ACTIONS: 'true',
          GITHUB_RUN_ID: '12345',
          GITHUB_WORKFLOW: 'test',
          GITHUB_RUN_NUMBER: '1',
          GITHUB_JOB: 'test',
          GITHUB_SHA: 'abc',
          GITHUB_REPOSITORY: 'test/test',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_RUN_ATTEMPT: '1',
        },
        'invalid'
      )
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Invalid format')
    })
  })

  describe('User-provided environment variables', () => {
    test('should allow DD_CI_* and DD_GIT_* variables to override detected values', async () => {
      const {context, code} = await runCLI({
        GITHUB_ACTIONS: 'true',
        GITHUB_RUN_ID: '12345',
        GITHUB_WORKFLOW: 'Test Workflow',
        GITHUB_RUN_NUMBER: '42',
        GITHUB_JOB: 'test-job',
        GITHUB_SHA: 'abc123def456',
        GITHUB_REPOSITORY: 'DataDog/test',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_RUN_ATTEMPT: '1',
        // User-provided overrides
        DD_CI_JOB_NAME: 'custom-job-name',
        DD_CI_PIPELINE_URL: 'https://custom.example.com/pipeline',
        DD_GIT_COMMIT_SHA: 'custom-sha-override',
        DD_GIT_BRANCH: 'custom-branch',
      })
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_JOB_NAME='custom-job-name'")
      expect(output).toContain("DD_CI_PIPELINE_URL='https://custom.example.com/pipeline'")
      expect(output).toContain("DD_GIT_COMMIT_SHA='custom-sha-override'")
      expect(output).toContain("DD_GIT_BRANCH='custom-branch'")
    })

    test('should work with only user-provided variables (no CI detection)', async () => {
      const {context, code} = await runCLI({
        DD_CI_PROVIDER_NAME: 'custom',
        DD_CI_PIPELINE_ID: 'custom-pipeline-123',
        DD_GIT_COMMIT_SHA: 'abc123',
        DD_GIT_BRANCH: 'main',
      })
      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain("DD_CI_PROVIDER_NAME='custom'")
      expect(output).toContain("DD_CI_PIPELINE_ID='custom-pipeline-123'")
      expect(output).toContain("DD_GIT_COMMIT_SHA='abc123'")
      expect(output).toContain("DD_GIT_BRANCH='main'")
    })
  })
})
