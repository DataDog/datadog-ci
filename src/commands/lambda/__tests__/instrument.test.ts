jest.mock('fs')
jest.mock('aws-sdk')
jest.mock('../prompt')
jest.mock('../renderer', () => require('../__mocks__/renderer'))

import * as fs from 'fs'
import path from 'path'

import {config as aws_sdk_config, Lambda, SharedIniFileCredentials} from 'aws-sdk'
import {Cli} from 'clipanion/lib/advanced'

import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SESSION_TOKEN_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DEFAULT_LAYER_AWS_ACCOUNT,
  ENVIRONMENT_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '../constants'
import {InstrumentCommand} from '../instrument'
import {InstrumentationSettings, LambdaConfigOptions} from '../interfaces'
import {
  requestAWSCredentials,
  requestChangesConfirmation,
  requestDatadogEnvVars,
  requestEnvServiceVersion,
  requestFunctionSelection,
} from '../prompt'

import {
  createCommand,
  createMockContext,
  makeCli,
  makeMockLambda,
  mockAwsAccessKeyId,
  mockAwsSecretAccessKey,
  mockDatadogApiKey,
  mockDatadogEnv,
  mockDatadogService,
  mockDatadogVersion,
} from './fixtures'
const {version} = require(path.join(__dirname, '../../../../package.json'))
describe('lambda', () => {
  describe('instrument', () => {
    describe('execute', () => {
      const OLD_ENV = process.env
      beforeEach(() => {
        jest.resetModules()
        process.env = {}
      })
      afterAll(() => {
        process.env = OLD_ENV
      })

      test('prints dry run data for lambda library layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs12.x',
            },
          })
        )

        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '--layerVersion',
            '10',
            '--logLevel',
            'debug',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
            '--extra-tags',
            'layer:api,team:intake',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\n
[Dry Run] Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_SERVICE\\": \\"middletier\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"0.2\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\",
      \\"DD_LOG_LEVEL\\": \\"debug\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:10\\"
  ]
}
TagResource -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
"
`)
      })

      test('prints dry run data for lambda library and extension layers using kebab case args', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs12.x',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
            '--extra-tags',
            'layer:api,team:intake',
            '--layer-version',
            '10',
            '--extension-version',
            '5',
            '--merge-xray-traces',
            'true',
            '--flush-metrics-to-logs',
            'false',
            '--log-level',
            'debug',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\n
[Dry Run] Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"1234\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"true\\",
      \\"DD_SERVICE\\": \\"middletier\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"0.2\\",
      \\"DD_LOG_LEVEL\\": \\"debug\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:5\\",
    \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:10\\"
  ]
}
TagResource -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
"
`)
      })

      test('prints dry run data for lambda extension layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs12.x',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '--extensionVersion',
            '6',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
            '--extra-tags',
            'layer:api,team:intake',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\n
[Dry Run] Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"1234\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_SERVICE\\": \\"middletier\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"0.2\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Extension:6\\"
  ]
}
TagResource -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
"
`)
      })

      test('prints dry run data for lambda .NET layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'dotnetcore3.1',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '-v',
            '129',
            '--extra-tags',
            'layer:api,team:intake',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\n
[Dry Run] Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_API_KEY\\": \\"1234\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_SERVICE\\": \\"middletier\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"0.2\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\",
      \\"CORECLR_ENABLE_PROFILING\\": \\"1\\",
      \\"CORECLR_PROFILER\\": \\"{846F5F1C-F9AE-4B07-969E-05C26BC060D8}\\",
      \\"CORECLR_PROFILER_PATH\\": \\"/opt/datadog/Datadog.Trace.ClrProfiler.Native.so\\",
      \\"DD_DOTNET_TRACER_HOME\\": \\"/opt/datadog\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:us-east-1:464622532012:layer:dd-trace-dotnet:129\\"
  ]
}
TagResource -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
"
`)
      })

      test('instrumenting with source code integrations fails if not run within a git repo', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        process.env.DATADOG_API_KEY = '1234'
        const cli = makeCli()
        const context = createMockContext() as any
        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
            '-s',
            '--service',
            'dummy',
            '--env',
            'dummy',
            '--version',
            '0.1',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(output.replace('\n', '')).toMatch(/.*Error: Couldn't get local git status.*/)
      })

      test('ensure the instrument command ran from a dirty git repo fails', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        process.env.DATADOG_API_KEY = '1234'
        const context = createMockContext() as any
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentCommand.prototype as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 0,
          isClean: false,
        }))

        const cli = new Cli()
        cli.register(instrumentCommand)

        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
            '-s',
            '--service',
            'dummy',
            '--env',
            'dummy',
            '--version',
            '0.1',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(output).toMatch('Error: Local git repository is dirty')
      })

      test('ensure source code integration flag works from a clean repo', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        process.env.DATADOG_API_KEY = '1234'
        const context = createMockContext() as any
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentCommand.prototype as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 0,
          hash: '1be168ff837f043bde17c0314341c84271047b31',
          remote: 'git.repository_url:git@github.com:datadog/test.git',
          isClean: true,
        }))

        const cli = new Cli()
        cli.register(instrumentCommand)

        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
            '-s',
            '--service',
            'dummy',
            '--env',
            'dummy',
            '--version',
            '0.1',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function\n
[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\n
Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"1234\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"dummy\\",
      \\"DD_TAGS\\": \\"git.commit.sha:1be168ff837f043bde17c0314341c84271047b31,git.repository_url:git.repository_url:github.com/datadog/test.git\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_SERVICE\\": \\"dummy\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"0.1\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:10\\"
  ]
}
TagResource -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
"
`)
      })

      test('ensure the instrument command ran from a local git repo ahead of the origin fails', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        process.env.DATADOG_API_KEY = '1234'
        const context = createMockContext() as any
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentCommand.prototype as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 1,
          isClean: true,
        }))

        const cli = new Cli()
        cli.register(instrumentCommand)

        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
            '-s',
            '--service',
            'dummy',
            '--env',
            'dummy',
            '--version',
            '0.1',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(output).toMatch('Error: Local changes have not been pushed remotely. Aborting git data tagging.')
      })

      test('runs function update command for lambda library layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        const cli = makeCli()
        const context = createMockContext() as any
        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
          ],
          context
        )
        expect(lambda.updateFunctionConfiguration).toHaveBeenCalled()
      })

      test('runs function update command for lambda extension layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const lambda = makeMockLambda({
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        })
        ;(Lambda as any).mockImplementation(() => lambda)
        const cli = makeCli()
        const context = createMockContext() as any
        process.env.DATADOG_API_KEY = '1234'
        await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--extensionVersion',
            '6',
          ],
          context
        )
        expect(lambda.updateFunctionConfiguration).toHaveBeenCalled()
      })

      test('aborts early when no functions are specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '--layerVersion',
            '10',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[Error] No functions specified to instrument.
"
`)
      })

      test('aborts early when no functions are specified while using config file', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['layerVersion'] = '60'
        command['config']['extensionVersion'] = '10'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['service'] = 'middletier'
        command['config']['environment'] = 'staging'
        command['config']['version'] = '0.2'

        await command['execute']()
        const output = command.context.stdout.toString()
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[Error] No functions specified to instrument.
"
`)
      })

      test("aborts early when function regions can't be found", async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'my-func',
            '--layerVersion',
            '10',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )

        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatch(
          `Couldn't group functions. Error: No default region specified for ["my-func"]. Use -r, --region, or use a full functionARN\n`
        )
      })

      test('aborts if a function is not in an Active state with LastUpdateStatus Successful', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              LastUpdateStatus: 'Unsuccessful',
              Runtime: 'nodejs12.x',
              State: 'Failed',
            },
          })
        )

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            '--layerVersion',
            '10',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )

        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[Error] Couldn't fetch Lambda functions. Error: Can't instrument arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world, as current State is Failed (must be \\"Active\\") and Last Update Status is Unsuccessful (must be \\"Successful\\")
"
`)
      })

      test('aborts early when extensionVersion and forwarder are set', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '--function',
            'test-function-arn',
            '--forwarder',
            'arn:aws:lambda:sa-east-1:000000000000:function:datadog-forwarder',
            '--extensionVersion',
            '6',
            '--region',
            'us-east-1',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[Error] \\"extensionVersion\\" and \\"forwarder\\" should not be used at the same time.
"
`)
      })

      test('check if functions are not empty while using config file', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['layerVersion'] = '60'
        command['config']['extensionVersion'] = '10'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        await command['execute']()
        expect(command['config']['functions']).toHaveLength(1)
      })
      test('aborts if functions and a pattern are set at the same time', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        let command = createCommand(InstrumentCommand)
        command['config']['environment'] = 'staging'
        command['config']['service'] = 'middletier'
        command['config']['version'] = '2'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        await command['execute']()
        let output = command.context.stdout.toString()
        expect(output).toMatch(
          'Functions in config file and "--functions-regex" should not be used at the same time.\n'
        )

        command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['region'] = 'ap-southeast-1'
        command['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        await command['execute']()
        output = command.context.stdout.toString()
        expect(output).toMatch('"--functions" and "--functions-regex" should not be used at the same time.\n')
      })
      test('aborts if pattern is set and no default region is specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}

        const command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['regExPattern'] = 'valid-pattern'
        await command['execute']()
        const output = command.context.stdout.toString()
        expect(output).toMatch('[Error] No default region specified. Use `-r`, `--region`.\n')
      })
      test('aborts if the regEx pattern is an ARN', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['region'] = 'ap-southeast-1'
        command['regExPattern'] = 'arn:aws:lambda:ap-southeast-1:123456789012:function:*'
        await command['execute']()
        const output = command.context.stdout.toString()
        expect(output).toMatch(`"--functions-regex" isn't meant to be used with ARNs.\n`)
      })

      test('instrument multiple functions interactively', async () => {
        const node18LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node18-x`
        const node16LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node16-x`
        const node14LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node14-x`
        const node12LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node12-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda(
            {
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
                FunctionName: 'lambda-hello-world',
                Handler: 'index.handler',
                Runtime: 'nodejs12.x',
              },
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
                FunctionName: 'lambda-hello-world-2',
                Handler: 'index.handler',
                Runtime: 'nodejs14.x',
              },
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3',
                FunctionName: 'lambda-hello-world-3',
                Handler: 'index.handler',
                Runtime: 'nodejs16.x',
              },
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-4': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3',
                FunctionName: 'lambda-hello-world-4',
                Handler: 'index.handler',
                Runtime: 'nodejs18.x',
              },
            },
            {
              [`${node14LibraryLayer}:1`]: {
                LayerVersionArn: `${node14LibraryLayer}:1`,
                Version: 1,
              },
              [`${node12LibraryLayer}:1`]: {
                LayerVersionArn: `${node12LibraryLayer}:1`,
                Version: 1,
              },
              [`${node16LibraryLayer}:1`]: {
                LayerVersionArn: `${node16LibraryLayer}:1`,
                Version: 1,
              },
              [`${node18LibraryLayer}:1`]: {
                LayerVersionArn: `${node18LibraryLayer}:1`,
                Version: 1,
              },
              [`${extensionLayer}:1`]: {
                LayerVersionArn: `${extensionLayer}:1`,
                Version: 1,
              },
            }
          )
        )
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = mockDatadogApiKey
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
        ])
        ;(requestChangesConfirmation as any).mockImplementation(() => true)

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
\n[!] Configure AWS region.
\n[!] Configure Datadog settings.
\n[Warning] The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.\n
Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node12-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node14-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
[!] Confirmation needed.
[!] Instrumenting functions.
"
`)
      })

      test('instrument multiple specified functions interactively', async () => {
        const node14LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node14-x`
        const node16LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node16-x`
        const node12LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node12-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda(
            {
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
                FunctionName: 'lambda-hello-world',
                Handler: 'index.handler',
                Runtime: 'nodejs12.x',
              },
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
                FunctionName: 'lambda-hello-world-2',
                Handler: 'index.handler',
                Runtime: 'nodejs14.x',
              },
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3',
                FunctionName: 'lambda-hello-world-3',
                Handler: 'index.handler',
                Runtime: 'nodejs16.x',
              },
            },
            {
              [`${node14LibraryLayer}:1`]: {
                LayerVersionArn: `${node14LibraryLayer}:1`,
                Version: 1,
              },
              [`${node12LibraryLayer}:1`]: {
                LayerVersionArn: `${node12LibraryLayer}:1`,
                Version: 1,
              },
              [`${node16LibraryLayer}:1`]: {
                LayerVersionArn: `${node16LibraryLayer}:1`,
                Version: 1,
              },
              [`${extensionLayer}:1`]: {
                LayerVersionArn: `${extensionLayer}:1`,
                Version: 1,
              },
            }
          )
        )
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
          process.env[AWS_SESSION_TOKEN_ENV_VAR] = 'some-session-token'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = mockDatadogApiKey
        })
        ;(requestChangesConfirmation as any).mockImplementation(() => true)

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-i',
            '-f',
            'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
            '-f',
            'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
\n[!] Configure AWS region.
\n[!] Configure Datadog settings.
\n[Warning] The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.\n
Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node12-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node14-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
[!] Confirmation needed.
[!] Instrumenting functions.
"
`)
      })

      test('aborts if a problem occurs while setting the AWS credentials interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(requestAWSCredentials as any).mockImplementation(() => Promise.reject('Unexpected error'))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
[Error] Unexpected error
"
`)
      })

      test('aborts if a problem occurs while setting the Datadog Environment Variables interactively', async () => {
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa,-east-1',
        }
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(requestDatadogEnvVars as any).mockImplementation(() => Promise.reject('Unexpected error'))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
\n[!] Configure AWS region.
\n[!] Configure Datadog settings.
[Error] Unexpected error
"
`)
      })

      test('when provided it sets DD_ENV, DD_SERVICE, and DD_VERSION environment variables in interactive mode', async () => {
        const node12LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node12-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda(
            {
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
                FunctionName: 'lambda-hello-world',
                Handler: 'index.handler',
                Runtime: 'nodejs12.x',
              },
            },
            {
              [`${node12LibraryLayer}:1`]: {
                LayerVersionArn: `${node12LibraryLayer}:1`,
                Version: 1,
              },
              [`${extensionLayer}:1`]: {
                LayerVersionArn: `${extensionLayer}:1`,
                Version: 1,
              },
            }
          )
        )
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = mockDatadogApiKey
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        ])
        ;(requestChangesConfirmation as any).mockImplementation(() => true)
        ;(requestEnvServiceVersion as any).mockImplementation(() => {
          process.env[ENVIRONMENT_ENV_VAR] = mockDatadogEnv
          process.env[SERVICE_ENV_VAR] = mockDatadogService
          process.env[VERSION_ENV_VAR] = mockDatadogVersion
        })

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
\n[!] Configure AWS region.
\n[!] Configure Datadog settings.
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.

Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_ENV\\": \\"sandbox\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_SERVICE\\": \\"testServiceName\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_VERSION\\": \\"1.0.0\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node12-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
[!] Confirmation needed.
[!] Instrumenting functions.
"
`)
      })

      test('when not provided it does not set DD_ENV, DD_SERVICE, and DD_VERSION tags in interactive mode', async () => {
        const node12LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node12-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda(
            {
              'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
                FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
                FunctionName: 'lambda-hello-world',
                Handler: 'index.handler',
                Runtime: 'nodejs12.x',
              },
            },
            {
              [`${node12LibraryLayer}:1`]: {
                LayerVersionArn: `${node12LibraryLayer}:1`,
                Version: 1,
              },
              [`${extensionLayer}:1`]: {
                LayerVersionArn: `${extensionLayer}:1`,
                Version: 1,
              },
            }
          )
        )
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = mockDatadogApiKey
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        ])
        ;(requestChangesConfirmation as any).mockImplementation(() => true)
        ;(requestEnvServiceVersion as any).mockImplementation(() => {
          process.env[ENVIRONMENT_ENV_VAR] = undefined
          process.env[SERVICE_ENV_VAR] = undefined
          process.env[VERSION_ENV_VAR] = undefined
        })

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
\n[!] Configure AWS region.
\n[!] Configure Datadog settings.
\n[Warning] The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.
\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
\t[Warning] At least one latest layer version is being used. Ensure to lock in versions for production applications using \`--layerVersion\` and \`--extensionVersion\`.

Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"02aeb762fff59ac0d5ad1536cd9633bd\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_CAPTURE_LAMBDA_PAYLOAD\\": \\"false\\",
      \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
      \\"DD_TRACE_ENABLED\\": \\"true\\",
      \\"DD_FLUSH_TO_LOG\\": \\"true\\"
    }
  },
  \\"Layers\\": [
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:1\\",
    \\"arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Node12-x:1\\"
  ]
}
TagResource -> arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world
{
  \\"dd_sls_ci\\": \\"v${version}\\"
}
[!] Confirmation needed.
[!] Instrumenting functions.
"
`)
      })

      test('aborts if there are no functions to instrument in the user AWS account', async () => {
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
          [CI_SITE_ENV_VAR]: 'datadoghq.com',
          [CI_API_KEY_ENV_VAR]: mockDatadogApiKey,
        }
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
\n[!] Configure AWS region.
[Error] Couldn't find any Lambda functions in the specified region.
"
`)
      })

      test('aborts early when the aws-sdk throws an error while instrumenting interactively', async () => {
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
          [CI_SITE_ENV_VAR]: 'datadoghq.com',
          [CI_API_KEY_ENV_VAR]: mockDatadogApiKey,
        }
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => ({
          listFunctions: jest.fn().mockImplementation(() => ({promise: () => Promise.reject('ListFunctionsError')})),
        }))

        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '-i'], context)
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
\n[!] Configure AWS region.
[Error] Couldn't fetch Lambda functions. Error: Max retry count exceeded. ListFunctionsError
"
`)
      })

      test('aborts early when a layer version is set for Ruby', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'ruby2.7',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '-v',
            '40',
            '--extra-tags',
            'layer:api,team:intake',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
[Error] Couldn't fetch Lambda functions. Error: Only the --extension-version argument should be set for the ruby2.7 runtime. Please remove the --layer-version argument from the instrument command.
"
`)
      })

      test('aborts early when a layer version is set for a Custom runtime', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'provided.al2',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '-v',
            '6',
            '--extra-tags',
            'layer:api,team:intake',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
[Error] Couldn't fetch Lambda functions. Error: Only the --extension-version argument should be set for the provided.al2 runtime. Please remove the --layer-version argument from the instrument command.
"
`)
      })

      test('aborts early when .NET is using ARM64 architecture', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              Architectures: ['arm64'],
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'dotnetcore3.1',
            },
          })
        )
        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = '1234'
        const code = await cli.run(
          [
            'lambda',
            'instrument',
            '-f',
            functionARN,
            '--dry',
            '-v',
            '6',
            '--extra-tags',
            'layer:api,team:intake',
            '--service',
            'middletier',
            '--env',
            'staging',
            '--version',
            '0.2',
          ],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n[Dry Run] 🐶 Instrumenting Lambda function
[Error] Couldn't fetch Lambda functions. Error: Instrumenting arm64 architecture is not supported for the given dd-extension version. Please choose the latest dd-extension version or use x86_64 architecture.
"
`)
      })

      test('instruments correctly with profile when provided', async () => {
        const credentials = {
          accessKeyId: mockAwsAccessKeyId,
          getPromise: () => Promise.resolve(),
          needsRefresh: () => false,
          secretAccessKey: mockAwsSecretAccessKey,
        } as any

        ;(SharedIniFileCredentials as any).mockImplementation(() => credentials)
        ;(Lambda as any).mockImplementation(() =>
          makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs14.x',
            },
          })
        )

        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const code = await cli.run(
          ['lambda', 'instrument', '-f', functionARN, '--profile', 'SOME-AWS-PROFILE'],
          context
        )
        expect(code).toBe(0)
        expect(aws_sdk_config.credentials?.accessKeyId).toBe(mockAwsAccessKeyId)
      })

      test('prints error when updating aws profile credentials fails', async () => {
        ;(SharedIniFileCredentials as any).mockImplementation(() => {
          throw Error('Update failed!')
        })

        const cli = makeCli()
        const context = createMockContext() as any
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const code = await cli.run(
          ['lambda', 'instrument', '-f', functionARN, '--profile', 'SOME-AWS-PROFILE'],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
"\n🐶 Instrumenting Lambda function
[Error] Error: Couldn't set AWS profile credentials. Update failed!
"
`)
      })
    })

    describe('getSettings', () => {
      test('uses config file settings', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['flushMetricsToLogs'] = 'false'
        command['config']['forwarder'] = 'my-forwarder'
        command['config']['layerVersion'] = '2'
        command['config']['extensionVersion'] = '6'
        command['config']['layerAWSAccount'] = 'another-account'
        command['config']['mergeXrayTraces'] = 'false'
        command['config']['tracing'] = 'false'
        command['config']['logLevel'] = 'debug'

        expect(command['getSettings']()).toEqual({
          captureLambdaPayload: false,
          environment: undefined,
          extensionVersion: 6,
          extraTags: undefined,
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          interactive: false,
          layerAWSAccount: 'another-account',
          layerVersion: 2,
          logLevel: 'debug',
          mergeXrayTraces: false,
          service: undefined,
          tracingEnabled: false,
          version: undefined,
        })
      })

      test('prefers command line arguments over config file', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['forwarder'] = 'my-forwarder'
        command['config']['forwarder'] = 'another-forwarder'
        command['layerVersion'] = '1'
        command['config']['layerVersion'] = '2'
        command['layerAWSAccount'] = 'my-account'
        command['config']['layerAWSAccount'] = 'another-account'
        command['mergeXrayTraces'] = 'true'
        command['config']['mergeXrayTraces'] = 'false'
        command['flushMetricsToLogs'] = 'false'
        command['config']['flushMetricsToLogs'] = 'true'
        command['tracing'] = 'true'
        command['config']['tracing'] = 'false'
        command['logLevel'] = 'debug'
        command['config']['logLevel'] = 'info'

        expect(command['getSettings']()).toEqual({
          captureLambdaPayload: false,
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          interactive: false,
          layerAWSAccount: 'my-account',
          layerVersion: 1,
          logLevel: 'debug',
          mergeXrayTraces: true,
          tracingEnabled: true,
        })
      })

      test("returns undefined when layer version can't be parsed", () => {
        process.env = {}

        const command = createCommand(InstrumentCommand)
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['layerVersion'] = 'abd'

        expect(command['getSettings']()).toBeUndefined()
      })

      test("returns undefined when extension version can't be parsed", () => {
        process.env = {}

        const command = createCommand(InstrumentCommand)
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['extensionVersion'] = 'abd'

        expect(command['getSettings']()).toBeUndefined()
      })

      test('converts string boolean from command line and config file correctly', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        const validSettings: InstrumentationSettings = {
          captureLambdaPayload: true,
          extensionVersion: undefined,
          flushMetricsToLogs: false,
          forwarderARN: undefined,
          interactive: false,
          layerAWSAccount: undefined,
          layerVersion: undefined,
          logLevel: undefined,
          mergeXrayTraces: false,
          tracingEnabled: true,
        }
        command['config']['captureLambdaPayload'] = 'truE'
        command['config']['flushMetricsToLogs'] = 'False'
        command['config']['mergeXrayTraces'] = 'falSE'
        command['config']['tracing'] = 'TRUE'

        expect(command['getSettings']()).toEqual(validSettings)

        command['config']['captureLambdaPayload'] = 'true'
        command['config']['flushMetricsToLogs'] = 'false'
        command['config']['mergeXrayTraces'] = 'false'
        command['config']['tracing'] = 'true'
        expect(command['getSettings']()).toEqual(validSettings)

        validSettings.captureLambdaPayload = false
        validSettings.flushMetricsToLogs = true
        validSettings.mergeXrayTraces = true
        validSettings.tracingEnabled = false

        command['captureLambdaPayload'] = 'faLSE'
        command['flushMetricsToLogs'] = 'truE'
        command['mergeXrayTraces'] = 'TRUe'
        command['tracing'] = 'FALSE'
        expect(command['getSettings']()).toEqual(validSettings)

        command['captureLambdaPayload'] = 'false'
        command['flushMetricsToLogs'] = 'true'
        command['mergeXrayTraces'] = 'true'
        command['tracing'] = 'false'
        expect(command['getSettings']()).toEqual(validSettings)
      })

      test('aborts early if converting string boolean has an invalid value', () => {
        process.env = {}
        const stringBooleans: (keyof Omit<LambdaConfigOptions, 'functions' | 'interactive'>)[] = [
          'flushMetricsToLogs',
          'mergeXrayTraces',
          'tracing',
        ]
        for (const option of stringBooleans) {
          let command = createCommand(InstrumentCommand)
          command['config'][option] = 'NotBoolean'
          command['getSettings']()

          let output = command.context.stdout.toString()
          expect(output).toMatch(`[Error] Invalid boolean specified for ${option}.\n`)

          command = createCommand(InstrumentCommand)
          command[option] = 'NotBoolean'
          command['getSettings']()

          output = command.context.stdout.toString()
          expect(output).toMatch(`Invalid boolean specified for ${option}.\n`)
        }
      })

      test('warns if any of environment, service or version tags are not set', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        let command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['getSettings']()
        let output = command.context.stdout.toString()
        expect(output).toMatch(
          '[Warning] The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.\n'
        )

        command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['config']['environment'] = 'b'
        command['config']['service'] = 'middletier'
        command['getSettings']()
        output = command.context.stdout.toString()
        expect(output).toMatch(
          '[Warning] The version tag has not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.\n'
        )
      })

      test('aborts early if extraTags do not comply with expected key:value list', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({}))

        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['config']['service'] = 'middletier'
        command['config']['environment'] = 'staging'
        command['config']['version'] = '0.2'
        command['config']['extraTags'] = 'not-complying:illegal-chars-in-key,complies:valid-pair'
        command['getSettings']()
        const output = command.context.stdout.toString()
        expect(output).toMatch('[Error] Extra tags do not comply with the <key>:<value> array.\n')
      })
    })
    describe('printPlannedActions', () => {
      test('prints no output when list is empty', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)

        command['printPlannedActions']([])
        const output = command.context.stdout.toString()
        expect(output).toMatchInlineSnapshot(`
                                        "
                                        No updates will be applied.
                                        "
                                `)
      })

      test('prints log group actions', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)

        command['printPlannedActions']([
          {
            functionARN: 'my-func',
            lambdaConfig: {} as any,
            logGroupConfiguration: {
              createLogGroupRequest: {logGroupName: 'my-log-group'} as any,
              deleteSubscriptionFilterRequest: {filterName: 'my-filter'} as any,
              logGroupName: 'my-log-group',
              subscriptionFilterRequest: {filterName: 'my-filter'} as any,
            },
          },
        ])
        const output = command.context.stdout.toString()
        expect(output).toMatchInlineSnapshot(`
"\n[Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.
\n[!] Functions to be updated:
\t- my-func\n
Will apply the following updates:
CreateLogGroup -> my-log-group
{
  \\"logGroupName\\": \\"my-log-group\\"
}
DeleteSubscriptionFilter -> my-log-group
{
  \\"filterName\\": \\"my-filter\\"
}
PutSubscriptionFilter -> my-log-group
{
  \\"filterName\\": \\"my-filter\\"
}
"
`)
      })
    })
  })
})
