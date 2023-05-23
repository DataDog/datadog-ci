import {Cli} from 'clipanion/lib/advanced'

import {MetricCommand, parseMetrics} from '../metric'

const makeCLI = () => {
  const cli = new Cli()
  cli.register(MetricCommand)

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

describe('parse metrics', () => {
  test('should fail if metrics key value pair does not contain a :', () => {
    expect(() => {
      parseMetrics(['notkeyvalue', 'key:1'])
    }).toThrow('invalid metrics key value pair "notkeyvalue"')
  })

  test('should fail if metrics key value pair is not numeric', () => {
    expect(() => {
      parseMetrics(['key:notanumber', 'key1:55'])
    }).toThrow('value is not numeric')
  })

  test('should work for all valid number types', () => {
    expect(parseMetrics(['int:1', 'float:1.1', 'negativeint:-1', 'negativefloat:-0.7391'])).toStrictEqual({
      float: 1.1,
      int: 1,
      negativefloat: -0.7391,
      negativeint: -1,
    })
  })
})

describe('execute', () => {
  const runCLI = async (level: string, metrics: string[], env: Record<string, string>) => {
    const cli = makeCLI()
    const context = createMockContext() as any
    process.env = {
      DATADOG_API_KEY: 'PLACEHOLDER',
      ...env,
    }

    const metricsList: string[] = []
    metrics.forEach((t: string) => {
      metricsList.push('--metrics')
      metricsList.push(t)
    })

    const code = await cli.run(['metric', '--level', level, ...metricsList], context)

    return {context, code}
  }

  test('should fail if an invalid level given', async () => {
    const {context, code} = await runCLI('stage', ['key:1'], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Level must be one of [pipeline, job]')
  })

  test('should fail if no metrics provided', async () => {
    const {context, code} = await runCLI('pipeline', [], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('--metrics is required')
  })

  test('should fail if not running in a supported provider', async () => {
    const {context, code} = await runCLI('pipeline', ['key:1'], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'Only providers [GitHub, GitLab, CircleCI, Buildkite, Buddy, Jenkins, TeamCity, AzurePipelines] are supported'
    )
  })

  test('should fail if provider is GitHub and level is job', async () => {
    const {context, code} = await runCLI('job', ['key:1'], {
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
