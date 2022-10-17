jest.mock('../../loggroup')

import {
  ENVIRONMENT_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
} from '../../constants'
import {
  getInstrumentedFunctionConfig,
  getInstrumentedFunctionConfigs,
  getInstrumentedFunctionConfigsFromRegEx,
} from '../../functions/instrument'
import * as loggroup from '../../loggroup'

import {makeMockCloudWatchLogs, makeMockLambda} from '../fixtures'

describe('instrument', () => {
  describe('getInstrumentedFunctionConfig', () => {
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
      const cloudWatch = makeMockCloudWatchLogs({})

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (
        await lambda
          .getFunction({FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'})
          .promise()
      ).Configuration
      await expect(
        getInstrumentedFunctionConfig(lambda as any, cloudWatch as any, config, 'us-east-1', settings)
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
      const cloudWatch = makeMockCloudWatchLogs({})

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (
        await lambda
          .getFunction({FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'})
          .promise()
      ).Configuration

      const result = await getInstrumentedFunctionConfig(
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
      const cloudWatch = makeMockCloudWatchLogs({})

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (
        await lambda
          .getFunction({FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'})
          .promise()
      ).Configuration
      expect(
        (await getInstrumentedFunctionConfig(lambda as any, cloudWatch as any, config, 'us-east-1', settings))
          .updateRequest
      ).toBeUndefined()
    })

    test('uses the GovCloud lambda layer when a GovCloud region is detected', async () => {
      const lambda = makeMockLambda({
        'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 30,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (
        await lambda
          .getFunction({FunctionName: 'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument'})
          .promise()
      ).Configuration
      const result = await getInstrumentedFunctionConfig(
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
      const cloudWatch = makeMockCloudWatchLogs({})
      const settings = {
        flushMetricsToLogs: false,
        forwarderARN: 'my-forwarder',
        layerVersion: 22,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const config = (
        await lambda
          .getFunction({FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'})
          .promise()
      ).Configuration
      const result = await getInstrumentedFunctionConfig(
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
  describe('getInstrumentedFunctionConfigs', () => {
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
      const cloudWatch = makeMockCloudWatchLogs({})
      const settings = {
        environment: 'staging',
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        service: 'middletier',
        tracingEnabled: false,
        version: '0.2',
      }
      const result = await getInstrumentedFunctionConfigs(
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
              "DD_ENV": "staging",
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_LOG_LEVEL": "debug",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SERVICE": "middletier",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
              "DD_VERSION": "0.2",
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
          Environment: {
            Variables: {
              [FLUSH_TO_LOG_ENV_VAR]: 'false',
              [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
              [LOG_LEVEL_ENV_VAR]: 'debug',
              [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
              [SITE_ENV_VAR]: 'datadoghq.com',
              [TRACE_ENABLED_ENV_VAR]: 'false',
              [SERVICE_ENV_VAR]: 'middletier',
              [ENVIRONMENT_ENV_VAR]: 'staging',
              [VERSION_ENV_VAR]: '0.2',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})

      const settings = {
        environment: 'staging',
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        service: 'middletier',
        tracingEnabled: false,
        version: '0.2',
      }
      const result = await getInstrumentedFunctionConfigs(
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
  describe('getInstrumentedFunctionConfigsFromRegEx', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })
    test('returns the update request for each function that matches the pattern', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby',
          FunctionName: 'autoinstrument-scooby',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scr.': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scr.',
          FunctionName: 'autoinstrument-scr.',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})
      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getInstrumentedFunctionConfigsFromRegEx(
        lambda as any,
        cloudWatch as any,
        'us-east-1',
        'autoinstrument-scr.',
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
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scr.",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": Array [
            "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22",
          ],
        }
      `)
    })
    test('fails when retry count is exceeded', async () => {
      const makeMockLambdaListFunctionsError = () => ({
        listFunctions: jest.fn().mockImplementation((args) => ({
          promise: () => Promise.reject('ListFunctionsError'),
        })),
      })
      const lambda = makeMockLambdaListFunctionsError()
      const cloudWatch = makeMockCloudWatchLogs({})
      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      await expect(
        getInstrumentedFunctionConfigsFromRegEx(lambda as any, cloudWatch as any, 'us-east-1', 'fake-pattern', settings)
      ).rejects.toStrictEqual(new Error('Max retry count exceeded. ListFunctionsError'))
    })
  })
})
