jest.mock('../../loggroup')
jest.mock('../../renderers/instrument-uninstrument-renderer')

import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {LambdaClient, ListFunctionsCommand, Runtime} from '@aws-sdk/client-lambda'
import {mockClient} from 'aws-sdk-client-mock'

import 'aws-sdk-client-mock-jest'
import {
  API_KEY_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
} from '../../../../constants'

import {
  API_KEY_SECRET_ARN_ENV_VAR,
  AWS_LAMBDA_EXEC_WRAPPER,
  AWS_LAMBDA_EXEC_WRAPPER_VAR,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENABLE_PROFILING_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  SUBSCRIPTION_FILTER_NAME,
} from '../../constants'
import {getLambdaFunctionConfig} from '../../functions/commons'
import {
  calculateUpdateRequest,
  getUninstrumentedFunctionConfig,
  getUninstrumentedFunctionConfigs,
  getUninstrumentedFunctionConfigsFromRegEx,
} from '../../functions/uninstrument'
import * as loggroup from '../../loggroup'

import {mockLambdaClientCommands, mockLambdaConfigurations} from '../fixtures'

describe('uninstrument', () => {
  const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)
  const lambdaClientMock = mockClient(LambdaClient)
  const OLD_ENV = process.env

  describe('calculateUpdateRequest', () => {
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

    test('calculates an update request removing all variables set by the CI', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {
                [API_KEY_SECRET_ARN_ENV_VAR]: 'some-secret:arn:from:aws',
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [FLUSH_TO_LOG_ENV_VAR]: 'true',
                [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [SERVICE_ENV_VAR]: 'middletier',
                [SITE_ENV_VAR]: 'datadoghq.com',
                [TRACE_ENABLED_ENV_VAR]: 'true',
                [VERSION_ENV_VAR]: '0.2',
                USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'datadog_lambda.handler.handler',
            Runtime: 'python3.8',
          },
        },
      })
      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "USER_VARIABLE": "shouldnt be deleted by uninstrumentation",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
        }
      `)
    })

    test('calculates an update request setting the previous handler', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {
                [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'datadog_lambda.handler.handler',
            Runtime: 'python3.8',
          },
        },
      })
      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
        }
      `)
    })

    test('calculates an update request removing lambda layers set by the CI', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {
                [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'datadog_lambda.handler.handler',
            Layers: [
              {
                Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Extension:11',
                CodeSize: 0,
                SigningJobArn: 'some-signing-job-arn',
                SigningProfileVersionArn: 'some-signing-profile',
              },
              {
                Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Python38:49',
                CodeSize: 0,
                SigningJobArn: 'some-signing-job-arn',
                SigningProfileVersionArn: 'some-signing-profile',
              },
            ],
            Runtime: 'python3.8',
          },
        },
      })
      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
          "Layers": [],
        }
      `)
    })

    describe('handlers using AWS_LAMBDA_EXEC_WRAPPER', () => {
      beforeEach(() => {
        jest.resetModules()
        process.env = {}

        mockLambdaClientCommands(lambdaClientMock)
      })
      afterAll(() => {
        process.env = OLD_ENV
      })

      test('removes lambda exec wrapper for .NET', async () => {
        const config = {
          Environment: {
            Variables: {
              [AWS_LAMBDA_EXEC_WRAPPER_VAR]: AWS_LAMBDA_EXEC_WRAPPER,
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:dotnet',
          Runtime: Runtime.dotnet6,
        }

        const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
        expect(updateRequest).toMatchInlineSnapshot(`
          {
            "Environment": {
              "Variables": {},
            },
            "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:dotnet",
          }
        `)
      })

      test('removes lambda exec wrapper for Java', async () => {
        const config = {
          Environment: {
            Variables: {
              [AWS_LAMBDA_EXEC_WRAPPER_VAR]: AWS_LAMBDA_EXEC_WRAPPER,
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:java',
          Runtime: Runtime.java11,
        }
        const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
        expect(updateRequest).toMatchInlineSnapshot(`
          {
            "Environment": {
              "Variables": {},
            },
            "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:java",
          }
        `)
      })

      test('doesnt remove variable when it doesnt match datadog instrumentation', async () => {
        const config = {
          Environment: {
            Variables: {
              [AWS_LAMBDA_EXEC_WRAPPER_VAR]: 'my-custom-wrapper',
              [SITE_ENV_VAR]: 'datadoghq.com', // to trigger an update request
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:dotnet-custom',
          Runtime: Runtime.dotnet6,
        }
        const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
        expect(updateRequest).toMatchInlineSnapshot(`
          {
            "Environment": {
              "Variables": {
                "AWS_LAMBDA_EXEC_WRAPPER": "my-custom-wrapper",
              },
            },
            "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:dotnet-custom",
          }
        `)
      })
    })
  })

  describe('getUninstrumentedFunctionConfigs', () => {
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

    test('returns the update request for each function', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [FLUSH_TO_LOG_ENV_VAR]: 'true',
                [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [SERVICE_ENV_VAR]: 'middletier',
                [SITE_ENV_VAR]: 'datadoghq.com',
                [TRACE_ENABLED_ENV_VAR]: 'true',
                [VERSION_ENV_VAR]: '0.2',
                [DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR]: 'false',
                [DD_LLMOBS_ENABLED_ENV_VAR]: 'true',
                [DD_LLMOBS_ML_APP_ENV_VAR]: 'my-ml-app',
                USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'datadog_lambda.handler.handler',
            Runtime: 'python3.8',
          },
        },
      })
      const result = await getUninstrumentedFunctionConfigs(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        ['arn:aws:lambda:us-east-1:000000000000:function:uninstrument'],
        undefined
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "USER_VARIABLE": "shouldnt be deleted by uninstrumentation",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
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
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })

      const result = await getUninstrumentedFunctionConfigs(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        [
          'arn:aws:lambda:us-east-1:000000000000:function:another-func',
          'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
        ],
        undefined
      )

      expect(result.length).toEqual(2)
      expect(result[0].updateFunctionConfigurationCommandInput).toBeUndefined()
      expect(result[1].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "index.handler",
        }
      `)
    })

    test('correctly removes .NET env vars', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {
                [FLUSH_TO_LOG_ENV_VAR]: 'false',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [SITE_ENV_VAR]: 'datadoghq.com',
                [TRACE_ENABLED_ENV_VAR]: 'false',
                [SERVICE_ENV_VAR]: 'middletier',
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [VERSION_ENV_VAR]: '0.2',
                [ENABLE_PROFILING_ENV_VAR]: '1',
                [PROFILER_ENV_VAR]: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
                [PROFILER_PATH_ENV_VAR]: '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so',
                [DOTNET_TRACER_HOME_ENV_VAR]: '/opt/datadog',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Runtime: 'dotnet6',
          },
        },
      })

      const result = await getUninstrumentedFunctionConfigs(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        ['arn:aws:lambda:us-east-1:000000000000:function:uninstrument'],
        undefined
      )

      expect(result[0].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
        }
      `)
    })
  })

  describe('getUninstrumentedFunctionConfig', () => {
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

    test('throws an error when it encounters an unsupported runtime', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Runtime: Runtime.go1x,
          },
        },
      })
      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      await expect(
        getUninstrumentedFunctionConfig(lambdaClientMock as any, cloudWatchLogsClientMock as any, config, undefined)
      ).rejects.toThrow()
    })

    test('returns configurations without updateRequest when no changes need to be made', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            Environment: {
              Variables: {},
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })

      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const uninstrumentedConfig = await getUninstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        config,
        undefined
      )

      expect(uninstrumentedConfig.updateFunctionConfigurationCommandInput).toBeUndefined()
    })

    test('returns log group configuration subscription delete request when forwarderARN is set', async () => {
      const logGroupName = '/aws/lambda/group'
      ;(loggroup.calculateLogGroupRemoveRequest as any).mockImplementation(() => ({
        filterName: SUBSCRIPTION_FILTER_NAME,
        logGroupName,
      }))

      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })
      const config = await getLambdaFunctionConfig(
        lambdaClientMock as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const result = await getUninstrumentedFunctionConfig(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        config,
        'valid-forwarder-arn'
      )
      expect(result).toBeDefined()
      expect(result.logGroupConfiguration).toMatchInlineSnapshot(`
        {
          "filterName": "${SUBSCRIPTION_FILTER_NAME}",
          "logGroupName": "${logGroupName}",
        }
      `)
    })
  })

  describe('getUninstrumentedFunctionConfigsFromRegEx', () => {
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

    test('returns the update request for each function that matches the pattern', async () => {
      mockLambdaConfigurations(lambdaClientMock, {
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby': {
          config: {
            Environment: {
              Variables: {
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [FLUSH_TO_LOG_ENV_VAR]: 'true',
                [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [SERVICE_ENV_VAR]: 'middletier',
                [SITE_ENV_VAR]: 'datadoghq.com',
                [TRACE_ENABLED_ENV_VAR]: 'true',
                [VERSION_ENV_VAR]: '0.2',
                USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scooby',
            FunctionName: 'autoinstrument-scooby',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Runtime: 'nodejs20.x',
          },
        },
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scrapy': {
          config: {
            Environment: {
              Variables: {
                [API_KEY_ENV_VAR]: '1234',
                [ENVIRONMENT_ENV_VAR]: 'staging',
                [FLUSH_TO_LOG_ENV_VAR]: 'true',
                [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                [LOG_LEVEL_ENV_VAR]: 'debug',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
              },
            },
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scrapy',
            FunctionName: 'autoinstrument-scrapy',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })
      const result = await getUninstrumentedFunctionConfigsFromRegEx(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        'autoinstrument-scr.',
        undefined
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateFunctionConfigurationCommandInput).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scrapy",
          "Handler": "index.handler",
        }
      `)
    })

    test('fails when retry count is exceeded', async () => {
      lambdaClientMock.on(ListFunctionsCommand).rejects('ListFunctionsError')

      const uninstrumentedConfig = getUninstrumentedFunctionConfigsFromRegEx(
        lambdaClientMock as any,
        cloudWatchLogsClientMock as any,
        'fake-pattern',
        undefined
      )

      await expect(uninstrumentedConfig).rejects.toThrow('ListFunctionsError')
    })
  })
})
