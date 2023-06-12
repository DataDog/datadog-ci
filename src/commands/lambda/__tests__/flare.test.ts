import process from 'process'
import util from 'util'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from '../constants'
import {getLambdaFunctionConfig} from '../functions/commons'
import {requestAWSCredentials} from '../prompt'

import {createMockContext, makeCli} from './fixtures'

jest.mock('../functions/commons', () => ({
  getAWSCredentials: jest.fn(),
  getLambdaFunctionConfig: jest.fn(),
}))

jest.mock('../prompt', () => ({
  requestAWSCredentials: jest.fn(),
}))

describe('lambda flare', () => {
  it('prints non-dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(1)
    expect(output).toMatchSnapshot()
  })

  it('prints dry-run header', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-d'], context as any)
    const output = context.stdout.toString()
    expect(code).toBe(1)
    expect(output).toMatchSnapshot()
  })

  it('prints error when no function specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toContain('No function name specified. [-f,--function]')
  })

  it('prints error when no region specified', async () => {
    process.env = {}
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toContain('No region specified. [-r,--region]')
  })

  it('extracts region from function name when given a function ARN', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      [
        'lambda',
        'flare',
        '-f',
        'arn:aws:lambda:us-west-2:123456789012:function:my-function',
        '--api-key',
        '123',
        '-e',
        'test@test.com',
      ],
      context as any
    )
    expect(code).toBe(0)
  })

  it('uses region ENV variable when no region specified', async () => {
    process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'test-region'
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)
  })

  it('prints error when no API key specified', async () => {
    process.env = {}
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toContain('No Datadog API key specified. [--api-key]')
  })

  it('uses API key ENV variable when no API key specified', async () => {
    process.env[CI_API_KEY_ENV_VAR] = 'test-api-key'
    process.env[API_KEY_ENV_VAR] = undefined
    const cli = makeCli()
    const context = createMockContext()
    let code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)

    process.env[CI_API_KEY_ENV_VAR] = undefined
    process.env[API_KEY_ENV_VAR] = 'test-api-key'
    code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-e', 'test@test.com'], context as any)
    expect(code).toBe(0)
  })

  it('requests AWS credentials when none are found', async () => {
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    const output = context.stdout.toString()
    expect(output).toContain("No AWS credentials found, let's set them up!")
    expect(requestAWSCredentials).toHaveBeenCalled()
  })

  it('runs successfully with all required options specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)
  })

  it('gets and logs the Lambda function configuration', async () => {
    const mockConfig = {
      Environment: {
        Variables: {
          DD_API_KEY: 'some-api-key',
          DD_SITE: 'datadoghq.com',
          DD_LOG_LEVEL: 'debug',
        },
      },
      FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:some-function',
      FunctionName: 'some-function',
    }
    ;(getLambdaFunctionConfig as jest.Mock).mockReturnValueOnce(mockConfig)
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '--api-key', '123', '-e', 'test@test.com'],
      context as any
    )
    const output = context.stdout.toString()
    expect(output).toContain(util.inspect(mockConfig, false, undefined, true))
  })
})
