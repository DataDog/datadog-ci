// tslint:disable: no-string-literal
jest.mock('fs')
jest.mock('aws-sdk')
import {Lambda} from 'aws-sdk'
import * as fs from 'fs'

import {Cli} from 'clipanion/lib/advanced'
import {InstrumentCommand} from '../instrument'

describe('lambda', () => {
  const createMockContext = () => {
    let data = ''

    return {
      stdout: {
        toString: () => data,
        write: (input: string) => {
          data += input
        },
      },
    }
  }
  const createCommand = () => {
    const command = new InstrumentCommand()
    command.context = createMockContext() as any

    return command
  }
  const makeCli = () => {
    const cli = new Cli()
    cli.register(InstrumentCommand)

    return cli
  }
  const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => ({
    getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
      promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
    })),
    updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
    listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
    tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({})})),
  })

  describe('instrument', () => {
    describe('execute', () => {
      test('prints dry run data', async () => {
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
          ['lambda', 'instrument', '-f', functionARN, '--dry', '--layerVersion', '10'],
          context
        )
        const output = context.stdout.toString()
        expect(code).toBe(0)
        expect(output).toMatchInlineSnapshot(`
          "[Dry Run] Will apply the following updates:
          UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world
          {
            \\"FunctionName\\": \\"arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world\\",
            \\"Handler\\": \\"/opt/nodejs/node_modules/datadog-lambda-js/handler.handler\\",
            \\"Layers\\": [
              \\"arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:10\\"
            ],
            \\"Environment\\": {
              \\"Variables\\": {
                \\"DD_LAMBDA_HANDLER\\": \\"index.handler\\",
                \\"DD_TRACE_ENABLED\\": \\"true\\",
                \\"DD_MERGE_XRAY_TRACES\\": \\"false\\",
                \\"DD_FLUSH_TO_LOG\\": \\"true\\"
              }
            }
          }
          "
        `)
      })
      test('runs function update command', async () => {
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
      test('aborts early when no functions are specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))
        const cli = makeCli()
        const context = createMockContext() as any
        const code = await cli.run(['lambda', 'instrument', '--layerVersion', '10'], context)
        const output = context.stdout.toString()
        expect(code).toBe(1)
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
        const code = await cli.run(['lambda', 'instrument', '--function', 'my-func', '--layerVersion', '10'], context)

        const output = context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
                                                  "'No default region specified for [\\"my-func\\"]. Use -r,--region, or use a full functionARN
                                                  "
                                        `)
      })
    })
    describe('getSettings', () => {
      test('uses config file settings', () => {
        process.env = {}
        const command = createCommand()
        command['config']['flushMetricsToLogs'] = false
        command['config']['forwarder'] = 'my-forwarder'
        command['config']['layerVersion'] = '2'
        command['config']['layerAWSAccount'] = 'another-account'
        command['config']['mergeXrayTraces'] = false
        command['config']['tracing'] = false

        expect(command['getSettings']()).toEqual({
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          layerAWSAccount: 'another-account',
          layerVersion: 2,
          mergeXrayTraces: false,
          tracingEnabled: false,
        })
      })

      test('prefers command line arguments over config file', () => {
        process.env = {}
        const command = createCommand()
        command['forwarder'] = 'my-forwarder'
        command['config']['forwarder'] = 'another-forwarder'
        command['layerVersion'] = '1'
        command['config']['layerVersion'] = '2'
        command['layerAWSAccount'] = 'my-account'
        command['config']['layerAWSAccount'] = 'another-account'
        command['mergeXrayTraces'] = true
        command['config']['mergeXrayTraces'] = false
        command['flushMetricsToLogs'] = false
        command['config']['flushMetricsToLogs'] = true
        command['tracing'] = true
        command['config']['tracing'] = false

        expect(command['getSettings']()).toEqual({
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          layerAWSAccount: 'my-account',
          layerVersion: 1,
          mergeXrayTraces: true,
          tracingEnabled: true,
        })
      })
      test('returns undefined when layer version is undefined', () => {
        process.env = {}

        const command = createCommand()
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['layerVersion'] = undefined

        expect(command['getSettings']()).toBeUndefined()
      })
      test("returns undefined when layer version can't be  parsed", () => {
        process.env = {}

        const command = createCommand()
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['layerVersion'] = 'abd'

        expect(command['getSettings']()).toBeUndefined()
      })
    })
    describe('collectFunctionsByRegion', () => {
      test('groups functions with region read from arn', () => {
        process.env = {}
        const command = createCommand()
        command['functions'] = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:us-east-1:123456789012:function:another',
          'arn:aws:lambda:us-east-2:123456789012:function:third-func',
        ]

        expect(command['collectFunctionsByRegion']()).toEqual({
          'us-east-1': [
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            'arn:aws:lambda:us-east-1:123456789012:function:another',
          ],
          'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
        })
      })
      test('groups functions in the config object', () => {
        process.env = {}
        const command = createCommand()
        command['config'].functions = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:us-east-1:123456789012:function:another',
          'arn:aws:lambda:us-east-2:123456789012:function:third-func',
        ]

        expect(command['collectFunctionsByRegion']()).toEqual({
          'us-east-1': [
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            'arn:aws:lambda:us-east-1:123456789012:function:another',
          ],
          'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
        })
      })

      test('uses default region for functions not in arn format', () => {
        process.env = {}
        const command = createCommand()
        command['functions'] = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:*:123456789012:function:func-with-wildcard',
          'func-without-region',
          'arn:aws:lambda:us-east-2:123456789012:function:third-func',
        ]
        command['region'] = 'ap-south-1'

        expect(command['collectFunctionsByRegion']()).toEqual({
          'ap-south-1': ['arn:aws:lambda:*:123456789012:function:func-with-wildcard', 'func-without-region'],
          'us-east-1': ['arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'],
          'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
        })
      })
      test('fails to collect when there are regionless functions and no default region is set', () => {
        process.env = {}
        const command = createCommand()
        command['functions'] = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:*:123456789012:function:func-with-wildcard',
          'func-without-region',
          'arn:aws:lambda:us-east-2:123456789012:function:third-func',
        ]
        command['region'] = undefined
        command['config']['region'] = undefined

        expect(command['collectFunctionsByRegion']()).toBeUndefined()
      })
    })
    describe('printPlannedActions', () => {
      test('prints no output when list is empty', () => {
        process.env = {}
        const command = createCommand()

        command['printPlannedActions']([])
        const output = command.context.stdout.toString()
        expect(output).toMatchInlineSnapshot(`
                                        "No updates will be applied
                                        "
                                `)
      })
      test('prints log group actions', () => {
        process.env = {}
        const command = createCommand()

        command['printPlannedActions']([
          {
            functionARN: 'my-func',
            lambdaConfig: {} as any,
            layerARN: 'my-layer',
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
                    "Will apply the following updates:
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
