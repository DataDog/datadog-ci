import chalk from 'chalk'
import {Cli} from 'clipanion/lib/advanced'

import {MeasureCommand, parseMeasures} from '../measure'

const makeCLI = () => {
  const cli = new Cli()
  cli.register(MeasureCommand)

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

describe('parse measures', () => {
  test('should fail if measures key value pair does not contain a :', () => {
    expect(() => {
      parseMeasures(['notkeyvalue', 'key:1'])
    }).toThrow('invalid measures key value pair "notkeyvalue"')
  })

  test('should fail if measures key value pair is not numeric', () => {
    expect(() => {
      parseMeasures(['key:notanumber', 'key1:55'])
    }).toThrow('value is not numeric')
  })

  test('should work for all valid number types', () => {
    expect(parseMeasures(['int:1', 'float:1.1', 'negativeint:-1', 'negativefloat:-0.7391'])).toStrictEqual({
      float: 1.1,
      int: 1,
      negativefloat: -0.7391,
      negativeint: -1,
    })
  })
})

describe('execute', () => {
  const runCLI = async (level: string, measures: string[], env: Record<string, string>) => {
    const cli = makeCLI()
    const context = createMockContext() as any
    process.env = {
      DATADOG_API_KEY: 'PLACEHOLDER',
      ...env,
    }

    const measuresList: string[] = []
    measures.forEach((t: string) => {
      measuresList.push('--measures')
      measuresList.push(t)
    })

    const code = await cli.run(['measure', '--level', level, ...measuresList], context)

    return {context, code}
  }

  test('should fail if an invalid level given', async () => {
    const {context, code} = await runCLI('stage', ['key:1'], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('Level must be one of [pipeline, job]')
  })

  test('should fail if no measures provided', async () => {
    const {context, code} = await runCLI('pipeline', [], {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'id'})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain('--measures is required')
  })

  test('should fail if not running in a supported provider', async () => {
    const {context, code} = await runCLI('pipeline', ['key:1'], {})
    expect(code).toBe(1)
    expect(context.stderr.toString()).toContain(
      'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
    )
  })
})

describe('warnings when deprecated metric mentioned', () => {
  test('should warn if metric command is used', async () => {
    const cli = makeCLI()
    const context = createMockContext() as any
    await cli.run(['metric', '--level', 'pipeline', '--measures', 'key:1'], context)
    expect(context.stdout.toString()).toBe(
      chalk.yellow('[WARN] The "metric" command is deprecated. Please use the "measure" command instead.\n')
    )
  })

  test('should double warn if metric command is used with metrics option', async () => {
    const cli = makeCLI()
    const context = createMockContext() as any
    await cli.run(['metric', '--level', 'pipeline', '--metrics', 'key:1'], context)
    expect(context.stdout.toString()).toBe(
      chalk.yellow(
        '[WARN] The "metric" command is deprecated. Please use the "measure" command instead.\n[WARN] The "--metrics" flag is deprecated. Please use "--measures" flag instead.\n'
      )
    )
  })

  test('should warn if metrics flag is used', async () => {
    const cli = makeCLI()
    const context = createMockContext() as any
    await cli.run(['measure', '--level', 'pipeline', '--metrics', 'key:1'], context)
    expect(context.stdout.toString()).toBe(
      chalk.yellow('[WARN] The "--metrics" flag is deprecated. Please use "--measures" flag instead.\n')
    )
  })
})
