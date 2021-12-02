// tslint:disable: no-string-literal
jest.mock('fs')
jest.mock('aws-sdk')
import {Lambda} from 'aws-sdk'
import {blueBright, bold, cyan, hex, underline, yellow} from 'chalk'
import {Cli} from 'clipanion/lib/advanced'
import * as fs from 'fs'
import path from 'path'
import {InstrumentCommand} from '../instrument'
import {InstrumentationSettings, LambdaConfigOptions} from '../interfaces'
import {createCommand, createMockContext, makeCli, makeMockLambda} from './fixtures'
// tslint:disable-next-line
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
"${bold(yellow('[Warning]'))} Instrument your ${hex('#FF9900').bold(
          'Lambda'
        )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
          'uninstrument'
        )}\` with the same arguments to revert the changes.
\n${bold(yellow('[!]'))} Functions to be updated:
\t- ${bold('arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world')}\n
${bold(cyan('[Dry Run] '))}Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
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
"${bold(yellow('[Warning]'))} Instrument your ${hex('#FF9900').bold(
          'Lambda'
        )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
          'uninstrument'
        )}\` with the same arguments to revert the changes.
\n${bold(yellow('[!]'))} Functions to be updated:
\t- ${bold('arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world')}\n
${bold(cyan('[Dry Run] '))}Will apply the following updates:
UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
{
  \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
  \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
  \\"Environment\\": {
    \\"Variables\\": {
      \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
      \\"DD_API_KEY\\": \\"1234\\",
      \\"DD_SITE\\": \\"datadoghq.com\\",
      \\"DD_ENV\\": \\"staging\\",
      \\"DD_TAGS\\": \\"layer:api,team:intake\\",
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
        expect(output).toMatch(/.*Make sure the command is running within your git repository\..*/i)
      })

      test('instrumenting with source code integrations fails if DATADOG_API_KEY is not provided', async () => {
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
        expect(output).toMatch(/.*Missing DATADOG_API_KEY in your environment.*/i)
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
          isClean: true,
        }))
        const mockUploadFunction = jest.spyOn(instrumentCommand.prototype as any, 'uploadGitData')
        mockUploadFunction.mockImplementation(() => {
          return
        })

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
"${bold(yellow('[Warning]'))} Instrument your ${hex('#FF9900').bold(
          'Lambda'
        )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
          'uninstrument'
        )}\` with the same arguments to revert the changes.
\n${bold(yellow('[!]'))} Functions to be updated:
\t- ${bold('arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world')}\n
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
      \\"DD_ENV\\": \\"dummy\\",
      \\"DD_TAGS\\": \\"git.commit.sha:1be168ff837f043bde17c0314341c84271047b31\\",
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
        expect(output).toMatch('Error: Local changes have not been pushed remotely. Aborting git upload.')
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
                                                            "No functions specified for instrumentation.
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
                                                            "No functions specified for instrumentation.
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
                                                  "Couldn't fetch lambda functions. Error: Can't instrument arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world, as current State is Failed (must be \\"Active\\") and Last Update Status is Unsuccessful (must be \\"Successful\\")
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
          "\\"extensionVersion\\" and \\"forwarder\\" should not be used at the same time.
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
        const stringBooleans: (keyof Omit<LambdaConfigOptions, 'functions'>)[] = [
          'flushMetricsToLogs',
          'mergeXrayTraces',
          'tracing',
        ]
        for (const option of stringBooleans) {
          let command = createCommand(InstrumentCommand)
          command['config'][option] = 'NotBoolean'
          command['getSettings']()

          let output = command.context.stdout.toString()
          expect(output).toMatch(`Invalid boolean specified for ${option}.\n`)

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
        await command['getSettings']()
        let output = command.context.stdout.toString()
        expect(output).toMatch(
          `${bold(
            yellow('[Warning]')
          )} The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: ${underline(
            blueBright(
              'https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.'
            )
          )}\n`
        )

        command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['config']['environment'] = 'b'
        command['config']['service'] = 'middletier'
        await command['getSettings']()
        output = command.context.stdout.toString()
        expect(output).toMatch(
          `${bold(
            yellow('[Warning]')
          )} The version tag has not been configured. Learn more about Datadog unified service tagging: ${underline(
            blueBright(
              'https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.'
            )
          )}\n`
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
        await command['getSettings']()
        const output = command.context.stdout.toString()
        expect(output).toMatch('Extra tags do not comply with the <key>:<value> array.\n')
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
                                        No updates will be applied
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
"${bold(yellow('[Warning]'))} Instrument your ${hex('#FF9900').bold(
          'Lambda'
        )} functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`${bold(
          'uninstrument'
        )}\` with the same arguments to revert the changes.
\n${bold(yellow('[!]'))} Functions to be updated:
\t- ${bold('my-func')}\n
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
