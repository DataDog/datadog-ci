jest.mock('../loggroup')

import {Lambda} from 'aws-sdk'
import {
  FLUSH_TO_LOG_ENV_VAR,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
} from '../constants'
import {calculateUpdateRequest, getExtensionArn, getFunctionConfiguration, getLambdaConfigs, getLayerArn, updateLambdaConfigs} from '../function'
import * as loggroup from '../loggroup'

const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => ({
  getFunction: jest.fn().mockImplementation(({FunctionName}) => ({
    promise: () => Promise.resolve({Configuration: functionConfigs[FunctionName]}),
  })),
  listFunctions: jest.fn().mockImplementation(() => ({
    promise: () => Promise.resolve({Functions: Object.values(functionConfigs)}),
  })),
  listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
  updateFunctionConfiguration: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

const makeMockCloudWatchLogs = () => ({})
const mockAwsAccount = '123456789012'
describe('function', () => {
  describe('getLambdaConfigs', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

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
        logLevel: 'debug',
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
              "DD_LOG_LEVEL": "debug",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
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

  })

  describe('getFunctionConfiguration', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
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
      const config = (await lambda.listFunctions().promise()).Functions[0]
      await expect(
        getFunctionConfiguration(
          lambda as any,
          cloudWatch as any,
          config,
          'us-east-1',
          settings
        )
      ).rejects.toThrow()
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
      const config = (await lambda.getFunction(
        { FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'}
      ).promise()).Configuration

      const result = await getFunctionConfiguration(
        lambda as any,
        cloudWatch as any,
        config,
        'us-east-1',
        settings
      )
      expect(result.updateRequest?.Layers).toMatchInlineSnapshot(`
                      Array [
                        "arn:aws:lambda:us-east-1:464622532012:layer:AnotherLayer:10",
                        "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:23",
                      ]
                `)
    })

    test('returns configurations without updateRequest when no changes need to be made', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          Environment: {
            Variables: {
              [FLUSH_TO_LOG_ENV_VAR]: 'false',
              [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
              [LOG_LEVEL_ENV_VAR]: 'debug',
              [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
              [SITE_ENV_VAR]: 'datadoghq.com',
              [TRACE_ENABLED_ENV_VAR]: 'false',
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
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (await lambda.getFunction(
        { FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'}
      ).promise()).Configuration
      expect(
        (await getFunctionConfiguration(
          lambda as any,
          cloudWatch as any,
          config,
          'us-east-1',
          settings
        )).updateRequest).toBeUndefined()
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
      const config = (await lambda.getFunction(
        { FunctionName: 'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument'}
      ).promise()).Configuration
      const result = await getFunctionConfiguration(
        lambda as any,
        cloudWatch as any,
        config,
        'us-gov-east-1',
        settings
      )
      expect(result.updateRequest?.Layers).toMatchInlineSnapshot(`
                      Array [
                        "arn:aws-us-gov:lambda:us-gov-east-1:002406178527:layer:Datadog-Node12-x:30",
                      ]
                `)
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
      const config = (await lambda.getFunction(
        { FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'}
      ).promise()).Configuration
      const result = await getFunctionConfiguration(
        lambda as any,
        cloudWatch as any,
        config,
        'us-east-1',
        settings
      )
      expect(result).toBeDefined()
      expect(result.logGroupConfiguration).toMatchInlineSnapshot(`
                Object {
                  "logGroupName": "/aws/lambda/group",
                }
            `)
    })
  })

  describe('getLambdaConfigsFromRegEx', () => {

  })

  describe('updateLambdaConfigs', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

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
                [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [TRACE_ENABLED_ENV_VAR]: 'false',
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
            [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
            [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
            [TRACE_ENABLED_ENV_VAR]: 'false',
          },
        },
        FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
        Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'],
      })
    })
  })

  describe('getLayerArn', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

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
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

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
      process.env = {}
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
              "DD_SITE": "datadoghq.com",
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

    test('calculates an update request with a lambda library, extension, and DATADOG_API_KEY', () => {
      process.env.DATADOG_API_KEY = '1234'
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
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": Array [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node12-x:5",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DATADOG_KMS_API_KEY', () => {
      process.env.DATADOG_KMS_API_KEY = '5678'
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
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": Array [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Python36:5",
          ],
        }
      `)
    })

    test('by default calculates an update request with DATADOG_SITE being set to datadoghq.com', () => {
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
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
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
        }
      `)
    })

    test('calculates an update request with DATADOG_SITE being set to datadoghq.eu', () => {
      process.env.DATADOG_SITE = 'datadoghq.eu'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
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
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.eu",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
        }
      `)
    })

    test('throws an error when an invalid DATADOG_SITE url is given', () => {
      process.env.DATADOG_SITE = 'datacathq.eu'
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
      const lambdaLibraryLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Python36`
      const lambdaExtensionLayerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Extension`
      const runtime = 'python3.6'

      expect(() => {
        calculateUpdateRequest(config, settings, lambdaLibraryLayerArn, lambdaExtensionLayerArn, runtime)
      }).toThrowError(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, or ddog-gov.com.'
      )
    })

    test('throws an error when neither DATADOG_API_KEY nor DATADOG_KMS_API_KEY are given through the environment while using extensionVersion', () => {
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
      }).toThrowError("When 'extensionLayer' is set, DATADOG_API_KEY or DATADOG_KMS_API_KEY must also be set")
    })
  })
})
