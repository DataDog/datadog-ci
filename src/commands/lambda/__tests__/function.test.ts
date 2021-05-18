jest.mock('../loggroup')

import {Lambda} from 'aws-sdk'
import {GOVCLOUD_LAYER_AWS_ACCOUNT} from '../constants'
import {calculateUpdateRequest, getExtensionArn, getLambdaConfigs, getLayerArn, updateLambdaConfigs} from '../function'
import * as loggroup from '../loggroup'

const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => ({
  getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
    promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
  })),
  listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

const makeMockCloudWatchLogs = () => ({})
const mockAwsAccount = '123456789012'
describe('function', () => {
  describe('getLambdaConfigs', () => {
    test('returns the update request for each function', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()
      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:autoinstrument",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": Array [
            "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22",
          ],
        }
      `)
    })

    test('returns configurations without updateRequest when no changes need to be made', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          Environment: {
            Variables: {
              DD_FLUSH_TO_LOG: 'false',
              DD_LAMBDA_HANDLER: 'index.handler',
              DD_MERGE_XRAY_TRACES: 'false',
              DD_TRACE_ENABLED: 'false',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
          Layers: [{Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'}],
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,

        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result[0].updateRequest).toBeUndefined()
    })

    test('replaces the layer arn when the version has changed', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Layers: [
            {Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'},
            {Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:AnotherLayer:10'},
          ],
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result[0].updateRequest?.Layers).toMatchInlineSnapshot(`
                      Array [
                        "arn:aws:lambda:us-east-1:464622532012:layer:AnotherLayer:10",
                        "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:23",
                      ]
                `)
    })
    test('uses the GovCloud lambda layer when a GovCloud region is detected', async () => {
      const lambda = makeMockLambda({
        'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 30,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-gov-east-1',
        ['arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result[0].updateRequest?.Layers).toMatchInlineSnapshot(`
                      Array [
                        "arn:aws-us-gov:lambda:us-gov-east-1:002406178527:layer:Datadog-Node12-x:30",
                      ]
                `)
    })
    test('returns results for multiple functions', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:another-func': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:another-func',
          Runtime: 'nodejs12.x',
        },
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        [
          'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          'arn:aws:lambda:us-east-1:000000000000:function:another-func',
        ],
        settings
      )
      expect(result.length).toEqual(2)
    })

    test('throws an error when it encounters an unsupported runtime', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Runtime: 'go',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      await expect(
        getLambdaConfigs(
          lambda as any,
          cloudWatch as any,
          'us-east-1',
          ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
          settings
        )
      ).rejects.toThrow()
    })

    test('requests log group configuration when forwarderARN is set', async () => {
      ;(loggroup.calculateLogGroupUpdateRequest as any).mockImplementation(() => ({logGroupName: '/aws/lambda/group'}))

      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()
      const settings = {
        flushMetricsToLogs: false,
        forwarderARN: 'my-forwarder',
        layerVersion: 22,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getLambdaConfigs(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result.length).toEqual(1)
      expect(result[0].logGroupConfiguration).toMatchInlineSnapshot(`
                Object {
                  "logGroupName": "/aws/lambda/group",
                }
            `)
    })
  })
  describe('updateLambdaConfigs', () => {
    test('updates every lambda', async () => {
      const lambda = makeMockLambda({})
      const configs = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          lambdaLibraryLayerArn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x',
          updateRequest: {
            Environment: {
              Variables: {
                DD_LAMBDA_HANDLER: 'index.handler',
                DD_MERGE_XRAY_TRACES: 'false',
                DD_TRACE_ENABLED: 'false',
              },
            },
            FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'],
          },
        },
      ]
      const cloudWatch = makeMockCloudWatchLogs()

      await updateLambdaConfigs(lambda as any, cloudWatch as any, configs)
      expect(lambda.updateFunctionConfiguration).toHaveBeenCalledWith({
        Environment: {
          Variables: {
            DD_LAMBDA_HANDLER: 'index.handler',
            DD_MERGE_XRAY_TRACES: 'false',
            DD_TRACE_ENABLED: 'false',
          },
        },
        FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
        Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'],
      })
    })
  })
  describe('getLayerArn', () => {
    test('gets sa-east-1 Node12 Lambda Library layer ARN', async () => {
      const runtime = 'nodejs12.x'
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn(runtime, settings, region)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Node12-x`)
    })
    test('gets sa-east-1 Python37 gov cloud Lambda Library layer ARN', async () => {
      const runtime = 'python3.7'
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(runtime, settings, region)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python37`)
    })
  })
  describe('getExtensionArn', () => {
    test('gets sa-east-1 Lambda Extension layer ARN', async () => {
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getExtensionArn(settings, region)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Extension`)
    })
    test('gets sa-east-1 gov cloud Lambda Extension layer ARN', async () => {
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getExtensionArn(settings, region)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`)
    })
  })
  describe('calculateUpdateRequest', () => {
    const OLD_ENV = process.env

    beforeEach(() => {
      jest.resetModules()
      process.env = {...OLD_ENV}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('calculates an update request with just lambda library layers', () => {
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const lambdaLibraryLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Node12-x`
      const lambdaExtensionLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Extension`
      const runtime = 'nodejs12.x'

      const updateRequest = calculateUpdateRequest(
        config,
        settings,
        lambdaLibraryLayerArn,
        lambdaExtensionLayerArn,
        runtime
      )
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": Array [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node12-x:5",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DD_API_KEY', () => {
      process.env.DD_API_KEY = '1234'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const lambdaLibraryLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Node12-x`
      const lambdaExtensionLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Extension`
      const runtime = 'nodejs12.x'

      const updateRequest = calculateUpdateRequest(
        config,
        settings,
        lambdaLibraryLayerArn,
        lambdaExtensionLayerArn,
        runtime
      )
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "DD_API_KEY": "1234",
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": Array [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node12-x:5",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DD_KMS_API_KEY', () => {
      process.env.DD_KMS_API_KEY = '5678'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const lambdaLibraryLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Python36`
      const lambdaExtensionLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Extension`
      const runtime = 'python3.6'

      const updateRequest = calculateUpdateRequest(
        config,
        settings,
        lambdaLibraryLayerArn,
        lambdaExtensionLayerArn,
        runtime
      )
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "DD_FLUSH_TO_LOG": "false",
              "DD_KMS_API_KEY": "5678",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": Array [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Python36:5",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
          ],
        }
      `)
    })

    test('throws an error when neither DD_API_KEY nor DD_KMS_API_KEY are given through the environment while using extensionVersion', () => {
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const lambdaLibraryLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Python36`
      const lambdaExtensionLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Extension`
      const runtime = 'python3.6'

      expect(() => {
        calculateUpdateRequest(config, settings, lambdaLibraryLayerArn, lambdaExtensionLayerArn, runtime)
      }).toThrowError("When 'extensionLayer' is set, DD_API_KEY or DD_KMS_API_KEY must also be set")
    })
  })
})
