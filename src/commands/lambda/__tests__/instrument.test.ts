jest.mock('fs')
jest.mock('aws-sdk')
import * as fs from 'fs'
import {InstrumentCommand} from '../instrument'
import {Lambda} from 'aws-sdk'

describe('lambda', () => {
  const createCommand = () => {
    const command = new InstrumentCommand()
    let data = ''
    command.context = {
      stdout: {
        toString: () => data,
        write: (input: string) => {
          data += input
        },
      },
    } as any
    return command
  }
  const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => {
    return {
      getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
        promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
      })),
      updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
    }
  }

  describe('instrument', () => {
    describe('execute', () => {
      test('prints dry run data', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => {
          return makeMockLambda({
            'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs12.x',
            },
          })
        })

        const command = createCommand()
        command['functions'] = ['arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world']
        command['dryRun'] = true
        command['layerVersion'] = '10'
        const code = await command['execute']()
        const output = command.context.stdout.toString()
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
                                    \\"DD_MERGE_XRAY_TRACES\\": \\"true\\"
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

        const command = createCommand()
        command['functions'] = ['arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world']
        command['layerVersion'] = '10'
        await command['execute']()
        expect(lambda.updateFunctionConfiguration).toHaveBeenCalled()
      })
      test('aborts early when no functions are specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))

        const command = createCommand()
        command['functions'] = []
        command['layerVersion'] = '10'
        const code = await command['execute']()
        expect(code).toBe(1)
        const output = command.context.stdout.toString()
        expect(code).toBe(1)
        expect(output).toMatchInlineSnapshot(`
                    "No functions specified for instrumentation.
                    "
                `)
      })
      test("aborts early when function regions can't be found", async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(Lambda as any).mockImplementation(() => makeMockLambda({}))

        const command = createCommand()
        command['functions'] = ['my-func']
        command['layerVersion'] = '10'
        const code = await command['execute']()
        expect(code).toBe(1)
        const output = command.context.stdout.toString()
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
        command['config']['layerVersion'] = '2'
        command['config']['layerAWSAccount'] = 'another-account'
        command['config']['mergeXrayTraces'] = false
        command['config']['tracing'] = false

        expect(command['getSettings']()).toEqual({
          layerAWSAccount: 'another-account',
          layerVersion: 2,
          mergeXrayTraces: false,
          tracingEnabled: false,
        })
      })

      test('prefers command line arguments over config file', () => {
        process.env = {}
        const command = createCommand()
        command['layerVersion'] = '1'
        command['config']['layerVersion'] = '2'
        command['layerAWSAccount'] = 'my-account'
        command['config']['layerAWSAccount'] = 'another-account'
        command['mergeXrayTraces'] = true
        command['config']['mergeXrayTraces'] = false
        command['tracing'] = true
        command['config']['tracing'] = false

        expect(command['getSettings']()).toEqual({
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
    describe('parseConfigFile', () => {
      test('should read a config file', async () => {
        ;(fs.readFile as any).mockImplementation((path: string, opts: any, callback: any) =>
          callback(undefined, '{"newconfigkey":"newconfigvalue"}')
        )

        const command = createCommand()

        await command['parseConfigFile']()
        expect((command['config'] as any)['newconfigkey']).toBe('newconfigvalue')
        ;(fs.readFile as any).mockRestore()
      })

      test('should throw an error if path is provided and config file is not found', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const command = createCommand()
        command['configPath'] = '/veryuniqueandabsentfile'
        await expect(command['parseConfigFile']()).rejects.toEqual(Error('Config file not found'))
      })

      test('should throw an error if JSON parsing fails', async () => {
        ;(fs.readFile as any).mockImplementation((p: string, o: any, cb: any) => cb(undefined, 'thisisnoJSON'))
        const command = new InstrumentCommand()

        await expect(command['parseConfigFile']()).rejects.toEqual(Error('Config file is not correct JSON'))
      })
    })
    describe('getLambdaService', () => {
      test('uses cli keys over values in config file', () => {
        let config: any
        ;(Lambda as any).mockImplementation((cfg: any) => {
          config = cfg
          return makeMockLambda({})
        })
        const command = createCommand()
        command['awsAccessKeyId'] = '1234'
        command['awsSecretAccessKey'] = '45678'
        command['config']['awsAccessKeyId'] = 'abcedf'
        command['config']['awsSecretAccessKey'] = 'ghijklm'
        const service = command['getLambdaService']('us-east-1')
        expect(config.accessKeyId).toEqual('1234')
        expect(config.secretAccessKey).toEqual('45678')
      })
      test('uses config file keys when available', () => {
        let config: any
        ;(Lambda as any).mockImplementation((cfg: any) => {
          config = cfg
          return makeMockLambda({})
        })
        const command = createCommand()
        command['config']['awsAccessKeyId'] = 'abcedf'
        command['config']['awsSecretAccessKey'] = 'ghijklm'
        const service = command['getLambdaService']('us-east-1')
        expect(config.accessKeyId).toEqual('abcedf')
        expect(config.secretAccessKey).toEqual('ghijklm')
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
        command['config']['functions'] = [
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
          'us-east-1': ['arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'],
          'ap-south-1': ['arn:aws:lambda:*:123456789012:function:func-with-wildcard', 'func-without-region'],
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
  })
})
