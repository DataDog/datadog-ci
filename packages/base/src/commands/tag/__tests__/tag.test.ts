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
    const {context, code} = await runCLI('stage', ['key:value'], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Level must be one of [pipeline, job]')
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
    fs.readdirSync = jest.fn().mockReturnValue([
      {
        name: 'Worker_2.log',
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
    fs.readFileSync = jest.fn().mockReturnValue(`{"jobDisplayName": "real job name"}`)
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
