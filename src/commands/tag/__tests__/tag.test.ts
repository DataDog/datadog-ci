import {Cli} from 'clipanion/lib/advanced'

import {TagCommand} from '../tag'

const makeCLI = () => {
  const cli = new Cli()
  cli.register(TagCommand)

  return cli
}

const createMockContext = () => {
  let out = ''
  let err = ''

  return {
    stderr: {
      toString: () => err,
      write: (input: string) => {
        err += input
      },
    },
    stdout: {
      toString: () => out,
      write: (input: string) => {
        out += input
      },
    },
  }
}

describe('execute', () => {
  const runCLI = async (level: string, tags: string[], env: Record<string, string>) => {
    const cli = makeCLI()
    const context = createMockContext() as any
    process.env = {
      DATADOG_API_KEY: 'PLACEHOLDER',
      ...env,
    }

    const tagsList: string[] = []
    tags.forEach((t: string) => {
      tagsList.push('--tags')
      tagsList.push(t)
    })

    const code = await cli.run(['tag', '--level', level, ...tagsList], context)

    return {context, code}
  }

  test('should fail if an invalid level given', async () => {
    const {context, code} = await runCLI('stage', ['key:value'], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Level must be one of [pipeline, job]')
  })

  test('should fail if no tags provided', async () => {
    const {context, code} = await runCLI('pipeline', [], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'DD_TAGS environment variable or --tags command line argument is required'
    )
  })

  test('should fail if not running in a supported provider', async () => {
    const {context, code} = await runCLI('pipeline', ['key:value'], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'Only providers [GitHub, GitLab, CircleCI, Buildkite, Buddy, Jenkins, TeamCity, AzurePipelines] are supported'
    )
  })

  test('should fail if provider is GitHub and level is job', async () => {
    const {context, code} = await runCLI('job', ['key:value'], {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'example/example',
      GITHUB_RUN_ATTEMPT: '10',
      GITHUB_RUN_ID: '40',
      GITHUB_SERVER_URL: 'github.com',
    })
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Cannot use level "job" for GitHub Actions.')
  })
})
