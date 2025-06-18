jest.mock('../../loggroup')

import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {
  LambdaClient,
  FunctionConfiguration as LFunctionConfiguration,
  ListFunctionsCommand,
  Runtime,
} from '@aws-sdk/client-lambda'
import {ENVIRONMENT_ENV_VAR, SERVICE_ENV_VAR, SITE_ENV_VAR, VERSION_ENV_VAR} from '@datadog/datadog-ci-core/constants'
import {mockClient} from 'aws-sdk-client-mock'

import {
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
} from '../../constants'
import {
  getInstrumentedFunctionConfig,
  getInstrumentedFunctionConfigs,
  getInstrumentedFunctionConfigsFromRegEx,
} from '../../functions/instrument'
import * as loggroup from '../../loggroup'

import {mockLambdaClientCommands, mockLambdaConfigurations} from '../fixtures'

describe('instrument', () => {
  const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)
  const lambdaClientMock = mockClient(LambdaClient)

  describe('getInstrumentedFunctionConfig', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      cloudWatchLogsClientMock.reset()
      lambdaClientMock.reset()
      jest.resetModules()
      process.env = {}

      mockLambdaClientCommands(lambdaClientMock)
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('does not redirect handler when no version is specified', async () => {
      const functionConfiguration: LFunctionConfiguration = {
        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: 'index.handler',
        Runtime: 'nodejs20.x',
      }
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: functionConfiguration,
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        // No layerVersion specified
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const result = await getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        functionConfiguration,
        'us-east-1',
        settings
      )

      // No change to Handler needed so it's not in the update params
      expect(result.updateFunctionConfigurationCommandInput?.Handler).toBeUndefined()
    })

    test('throws an error when it encounters an unsupported runtime', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Runtime: Runtime.go1x,
          },
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const instrumentedConfig = getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        {},
        'us-east-1',
        settings
      )

      await expect(instrumentedConfig).rejects.toThrow()
    })

    test('replaces the layer arn when the version has changed', async () => {
      const functionConfiguration: LFunctionConfiguration = {
        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Layers: [
          {Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22'},
          {Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:AnotherLayer:10'},
        ],
        Runtime: 'nodejs20.x',
      }

      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: functionConfiguration,
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 23,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const result = await getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        functionConfiguration,
        'us-east-1',
        settings
      )
      expect(result.updateFunctionConfigurationCommandInput?.Layers).toMatchInlineSnapshot(`
        [
          "arn:aws:lambda:us-east-1:464622532012:layer:AnotherLayer:10",
          "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:23",
        ]
      `)
    })

    test('returns configurations without updateRequest when no changes need to be made', async () => {
      const functionConfiguration: LFunctionConfiguration = {
        Environment: {
          Variables: {
            [FLUSH_TO_LOG_ENV_VAR]: 'false',
            [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
            [LOG_LEVEL_ENV_VAR]: 'debug',
            [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
            [SITE_ENV_VAR]: 'datadoghq.com',
            [TRACE_ENABLED_ENV_VAR]: 'false',
            [DD_LLMOBS_ENABLED_ENV_VAR]: 'true',
            [DD_LLMOBS_ML_APP_ENV_VAR]: 'my-ml-app',
          },
        },
        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
        Layers: [{Arn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22'}],
        Runtime: 'nodejs20.x',
      }
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: functionConfiguration,
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const instrumentedConfig = await getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        functionConfiguration,
        'us-east-1',
        settings
      )

      expect(instrumentedConfig.updateFunctionConfigurationCommandInput).toBeUndefined()
    })

    test('uses the GovCloud lambda layer when a GovCloud region is detected', async () => {
      const functionConfiguration: LFunctionConfiguration = {
        FunctionArn: 'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument',
        Runtime: 'nodejs20.x',
      }
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws-us-gov:lambda:us-gov-east-1:000000000000:function:autoinstrument': {
          config: functionConfiguration,
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 30,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const result = await getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        functionConfiguration,
        'us-gov-east-1',
        settings
      )
      expect(result.updateFunctionConfigurationCommandInput?.Layers).toMatchInlineSnapshot(`
        [
          "arn:aws-us-gov:lambda:us-gov-east-1:002406178527:layer:Datadog-Node20-x:30",
        ]
      `)
    })

    test('requests log group configuration when forwarderARN is set', async () => {
      ;(loggroup.calculateLogGroupUpdateRequest as any).mockImplementation(() => ({logGroupName: '/aws/lambda/group'}))

      const functionConfiguration: LFunctionConfiguration = {
        FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: 'index.handler',
        Runtime: 'nodejs20.x',
      }

      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: functionConfiguration,
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        forwarderARN: 'my-forwarder',
        layerVersion: 22,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const result = await getInstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        functionConfiguration,
        'us-east-1',
        settings
      )
      expect(result).toBeDefined()
      expect(result.logGroupConfiguration).toMatchInlineSnapshot(`
        {
          "logGroupName": "/aws/lambda/group",
        }
      `)
    })
  })
  describe('getInstrumentedFunctionConfigs', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      lambdaClientMock.reset()
      jest.resetModules()
      process.env = {}

      mockLambdaClientCommands(lambdaClientMock)
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns the update request for each function', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })

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
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        'us-east-1',
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        settings
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
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
          "Layers": [
            "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22",
          ],
        }
      `)
    })

    test('returns results for multiple functions', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:another-func': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:another-func',
            Runtime: 'nodejs20.x',
          },
        },
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
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
            Runtime: 'nodejs20.x',
          },
        },
      })

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
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
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
      lambdaClientMock.reset()
      jest.resetModules()
      process.env = {}

      mockLambdaClientCommands(lambdaClientMock)
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns the update request for each function that matches the pattern', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby',
            FunctionName: 'autoinstrument-scooby',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scr.': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scr.',
            FunctionName: 'autoinstrument-scr.',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const result = await getInstrumentedFunctionConfigsFromRegEx(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        'us-east-1',
        'autoinstrument-scr.',
        settings
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
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
          "Layers": [
            "arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22",
          ],
        }
      `)
    })

    test('fails when retry count is exceeded', async () => {
      lambdaClientMock.on(ListFunctionsCommand).rejects('ListFunctionsError')

      const settings = {
        flushMetricsToLogs: false,
        layerVersion: 22,
        logLevel: 'debug',
        mergeXrayTraces: false,
        tracingEnabled: false,
      }

      const instrumentedConfig = getInstrumentedFunctionConfigsFromRegEx(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        'us-east-1',
        'fake-pattern',
        settings
      )

      await expect(instrumentedConfig).rejects.toThrow('ListFunctionsError')
    })
  })
})
