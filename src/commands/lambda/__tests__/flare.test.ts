import fs from 'fs'
import process from 'process'
import * as stream from 'stream'

import axios from 'axios'
import FormData from 'form-data'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from '../constants'
import {requestAWSCredentials} from '../prompt'

import {createMockContext, makeCli} from './fixtures'

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

jest.mock('../functions/commons', () => ({
  getAWSCredentials: jest.fn(),
  getLambdaFunctionConfig: jest.fn().mockImplementation(() => Promise.resolve(mockConfig)),
  getRegion: jest.requireActual('../functions/commons').getRegion as () => string | undefined,
}))

jest.mock('../prompt', () => ({
  requestAWSCredentials: jest.fn(),
}))

jest.mock('fs')

describe('lambda flare', () => {
  beforeEach(() => {
    process.env = {}
    process.env[CI_API_KEY_ENV_VAR] = 'test-api-key'
    const mockReadStream = new stream.Readable({
      read() {
        this.push('mock file content')
        this.push(undefined)
      },
    })
    fs.promises.writeFile = jest.fn().mockResolvedValue(() => {})
    fs.promises.readFile = jest.fn().mockResolvedValue(JSON.stringify(mockConfig))
    fs.createReadStream = jest.fn().mockReturnValue(mockReadStream)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

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
      ['lambda', 'flare', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
  })

  it('prints error when no region specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-f', 'func', '-c', '123', '-e', 'test@test.com'], context as any)
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
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
        '-c',
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
    const code = await cli.run(['lambda', 'flare', '-f', 'func', '-c', '123', '-e', 'test@test.com'], context as any)
    expect(code).toBe(0)
  })

  it('prints error when no API key specified', async () => {
    process.env = {}
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
  })

  it('uses API key ENV variable', async () => {
    process.env = {}
    process.env[CI_API_KEY_ENV_VAR] = 'test-api-key'
    process.env[API_KEY_ENV_VAR] = undefined
    const cli = makeCli()
    const context = createMockContext()
    let code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)

    process.env[CI_API_KEY_ENV_VAR] = undefined
    process.env[API_KEY_ENV_VAR] = 'test-api-key'
    code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'test-region', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)
  })

  it('prints error when no case ID specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
  })

  it('prints error when no email specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123'], context as any)
    expect(code).toBe(1)
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
  })

  it('requests AWS credentials when none are found and logs output correctly', async () => {
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    const output = context.stdout.toString()
    expect(output).toMatchSnapshot()
    expect(requestAWSCredentials).toHaveBeenCalled()
  })

  it('runs successfully with all required options specified', async () => {
    const cli = makeCli()
    const context = createMockContext()
    const code = await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(code).toBe(0)
  })

  it('successfully adds zip file to FormData', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append')
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(appendSpy).toHaveBeenCalledWith('flare_file', expect.anything())
    appendSpy.mockRestore()
  })

  it('successfully sends request to Datadog', async () => {
    const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({status: 200})
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    expect(postSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'DD-API-KEY': 'test-api-key',
        }) as Record<string, string>,
      })
    )
    const output = context.stdout.toString()
    expect(output).toMatchSnapshot()
    postSpy.mockRestore()
  })

  it('does not sends request to Datadog when a dry run', async () => {
    const postSpy = (axios.post = jest.fn().mockRejectedValue({status: 500}))
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com', '-d'],
      context as any
    )
    expect(postSpy).not.toHaveBeenCalled()
    const output = context.stdout.toString()
    expect(output).toMatchSnapshot()
    postSpy.mockRestore()
  })

  it('fails to send request to Datadog', async () => {
    axios.post = jest.fn().mockRejectedValue({status: 500})
    const cli = makeCli()
    const context = createMockContext()
    await cli.run(
      ['lambda', 'flare', '-f', 'func', '-r', 'us-west-2', '-c', '123', '-e', 'test@test.com'],
      context as any
    )
    const output = context.stderr.toString()
    expect(output).toMatchSnapshot()
  })
})
