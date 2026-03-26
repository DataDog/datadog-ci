import fs from 'fs'

import {Cli} from 'clipanion'

import {createMockContext, getEnvVarPlaceholders} from '../../../helpers/__tests__/testing-tools'

import {TagCommand} from '../tag'

const fixturesPath = './src/commands/tag/__tests__/fixtures'

describe('execute', () => {
  const runCLI = async (level: string, tags: string[], env: Record<string, string>, extraArgs: string[] = []) => {
    const cli = new Cli()
    cli.register(TagCommand)

    const context = createMockContext()
    process.env = {
      ...env,
      ...getEnvVarPlaceholders(),
    }

    const tagsList: string[] = []
    tags.forEach((t: string) => {
      tagsList.push('--tags')
      tagsList.push(t)
    })

    const code = await cli.run(['tag', '--level', level, ...extraArgs, ...tagsList], context)

    return {context, code}
  }

  afterEach(() => {
    jest.resetAllMocks()
  })

  test('should fail if an invalid level given', async () => {
    const {context, code} = await runCLI('invalid', ['key:value'], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Level must be one of [pipeline, job, stage, step]')
  })

  test('should fail if stage level is used with unsupported provider', async () => {
    const {context, code} = await runCLI('stage', ['key:value'], {
      BUILDKITE: 'true',
      BUILDKITE_BUILD_ID: 'id',
      BUILDKITE_JOB_ID: 'id',
    })
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain("Level 'stage' is only supported for providers")
  })

  test('should fail if step level is used with non-github provider', async () => {
    const {context, code} = await runCLI('step', ['key:value'], {
      BUILDKITE: 'true',
      BUILDKITE_BUILD_ID: 'id',
      BUILDKITE_JOB_ID: 'id',
    })
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain("Level 'step' is only supported for provider [github]")
  })

  test('stage level works for gitlab', async () => {
    const result = await runCLI(
      'stage',
      ['key:value'],
      {
        GITLAB_CI: 'true',
        CI_PROJECT_URL: 'url',
        CI_PIPELINE_ID: 'id',
        CI_JOB_ID: 'job-id',
        CI_JOB_STAGE: 'test',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).toContain('"ci_level": 2')
  })

  test('stage level works for azure pipelines', async () => {
    const result = await runCLI(
      'stage',
      ['key:value'],
      {
        TF_BUILD: 'true',
        SYSTEM_TEAMPROJECTID: 'project-id',
        BUILD_BUILDID: '55',
        SYSTEM_JOBID: 'job-id',
        SYSTEM_STAGENAME: 'Build',
        SYSTEM_STAGEATTEMPT: '1',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).toContain('"ci_level": 2')
  })

  test('stage level works for jenkins', async () => {
    const result = await runCLI(
      'stage',
      ['key:value'],
      {
        JENKINS_URL: 'url',
        DD_CUSTOM_PARENT_ID: 'span-id',
        DD_CUSTOM_TRACE_ID: 'trace-id',
        DD_CUSTOM_STAGE_ID: 'stage-id',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).toContain('"ci_level": 2')
  })

  test('stage level fails for jenkins without DD_CUSTOM_STAGE_ID', async () => {
    const {context, code} = await runCLI('stage', ['key:value'], {
      JENKINS_URL: 'url',
      DD_CUSTOM_PARENT_ID: 'span-id',
      DD_CUSTOM_TRACE_ID: 'trace-id',
    })
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      "Level 'stage' for Jenkins requires the Datadog plugin version to be >= 9.2"
    )
  })

  test('step level works for github actions', async () => {
    jest.spyOn(fs, 'readdirSync').mockReturnValue([
      {
        name: 'Worker_1.log' as any,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        parentPath: '',
        path: '',
      },
    ])
    jest.spyOn(fs, 'readFileSync').mockReturnValue(
      `[2025-09-15 10:14:00Z INFO Worker] Job message:\n${JSON.stringify({
        jobDisplayName: 'real job name',
        steps: [{contextName: '__checkout'}, {contextName: '__run'}],
      })}`
    )
    const result = await runCLI(
      'step',
      ['key:value'],
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'url',
        GITHUB_REPOSITORY: 'repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'build',
        GITHUB_ACTION: '__run',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).toContain('"ci_level": 3')
    expect(out).toContain('"DD_GITHUB_JOB_NAME": "real job name"')
    expect(out).toContain('"DD_GITHUB_STEP_INDEX": "1"')
    jest.restoreAllMocks()
  })

  test('should fail if no tags provided', async () => {
    const {context, code} = await runCLI('pipeline', [], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      '[ERROR] DD_TAGS environment variable, --tags or --tags-file command line argument is required'
    )
  })

  test('should fail if --tags-file is provided but does not contain any tags', async () => {
    const {context, code} = await runCLI('pipeline', [], {}, ['--tags-file', `${fixturesPath}/empty.json`])
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      '[ERROR] DD_TAGS environment variable, --tags or --tags-file command line argument is required'
    )
  })

  test('should fail if --tags-file is provided but it is invalid', async () => {
    const {context, code} = await runCLI('pipeline', [], {}, ['--tags-file', `${fixturesPath}/invalid.json`])
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('[ERROR] could not parse JSON file')
  })

  test('should fail if not running in a supported provider', async () => {
    const {context, code} = await runCLI('pipeline', ['key:value'], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
    )
  })

  test('should not output anything if silent mode is enabled', async () => {
    const result = await runCLI(
      'pipeline',
      ['key:value'],
      {
        BUILDKITE: 'true',
        BUILDKITE_BUILD_ID: 'id',
      },
      ['--silent']
    )
    expect(result.context.stderr.toString()).toBe('')
    expect(result.context.stdout.toString()).toBe('')
  })

  test('all ok', async () => {
    const result = await runCLI(
      'pipeline',
      ['key:value'],
      {
        BUILDKITE: 'true',
        BUILDKITE_BUILD_ID: 'id',
        BUILDKITE_JOB_ID: 'id',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    expect(result.context.stdout.toString()).toContain('[DRYRUN] Tag request')
  })

  test('should try to determine github job display name', async () => {
    jest.spyOn(fs, 'readdirSync').mockReturnValue([
      {
        name: 'Worker_2.log' as any,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        parentPath: '',
        path: '',
      },
    ])
    jest.spyOn(fs, 'readFileSync').mockReturnValue(`{"jobDisplayName": "real job name"}`)
    const result = await runCLI(
      'job',
      ['key:value'],
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'url',
        GITHUB_REPOSITORY: 'repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'fake job name',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).toContain('Determining GitHub job name')
    expect(out).toContain('"DD_GITHUB_JOB_NAME": "real job name"')
  })

  test('should not try to determine github job display name for pipelines', async () => {
    const result = await runCLI(
      'pipeline',
      ['key:value'],
      {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'url',
        GITHUB_REPOSITORY: 'repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'fake job name',
      },
      ['--dry-run']
    )
    expect(result.code).toBe(0)
    const out = result.context.stdout.toString()
    expect(out).not.toContain('Determining GitHub job name')
    expect(out).not.toContain('"DD_GITHUB_JOB_NAME"')
  })
})
