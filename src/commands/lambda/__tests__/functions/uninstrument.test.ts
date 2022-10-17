jest.mock('../../loggroup')
import {
  API_KEY_ENV_VAR,
  API_KEY_SECRET_ARN_ENV_VAR,
  DOTNET_TRACER_HOME_ENV_VAR,
  ENABLE_PROFILING_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  PROFILER_ENV_VAR,
  PROFILER_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  SUBSCRIPTION_FILTER_NAME,
  TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
} from '../../constants'
import {getLambdaFunctionConfig} from '../../functions/commons'
import {
  calculateUpdateRequest,
  getUninstrumentedFunctionConfig,
  getUninstrumentedFunctionConfigs,
  getUninstrumentedFunctionConfigsFromRegEx,
} from '../../functions/uninstrument'
import * as loggroup from '../../loggroup'

import {makeMockCloudWatchLogs, makeMockLambda} from '../fixtures'

describe('uninstrument', () => {
  describe('calculateUpdateRequest', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('calculates an update request removing all variables set by the CI', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
      })
      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "USER_VARIABLE": "shouldnt be deleted by uninstrumentation",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
        }
      `)
    })

    test('calculates an update request setting the previous handler', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          Environment: {
            Variables: {
              [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Handler: 'datadog_lambda.handler.handler',
          Runtime: 'python3.8',
        },
      })
      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
        }
      `)
    })

    test('calculates an update request removing lambda layers set by the CI', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
      })
      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const updateRequest = calculateUpdateRequest(config, config.Runtime as any)
      expect(updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
          "Layers": Array [],
        }
      `)
    })
  })
  describe('getUninstrumentedFunctionConfigs', () => {
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
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
              USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Handler: 'datadog_lambda.handler.handler',
          Runtime: 'python3.8',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})
      const result = await getUninstrumentedFunctionConfigs(
        lambda as any,
        cloudWatch as any,
        ['arn:aws:lambda:us-east-1:000000000000:function:uninstrument'],
        undefined
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "USER_VARIABLE": "shouldnt be deleted by uninstrumentation",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "lambda_function.lambda_handler",
        }
      `)
    })

    test('returns results for multiple functions', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:another-func': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:another-func',
          Runtime: 'nodejs12.x',
        },
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})

      const result = await getUninstrumentedFunctionConfigs(
        lambda as any,
        cloudWatch as any,
        [
          'arn:aws:lambda:us-east-1:000000000000:function:another-func',
          'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
        ],
        undefined
      )

      expect(result.length).toEqual(2)
      expect(result[0].updateRequest).toBeUndefined()
      expect(result[1].updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          "Handler": "index.handler",
        }
      `)
    })

    test('correctly removes .NET env vars', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
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
          Runtime: 'dotnetcore3.1',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})

      const result = await getUninstrumentedFunctionConfigs(
        lambda as any,
        cloudWatch as any,
        ['arn:aws:lambda:us-east-1:000000000000:function:uninstrument'],
        undefined
      )

      expect(result[0].updateRequest).toMatchInlineSnapshot(`
          Object {
            "Environment": Object {
              "Variables": Object {},
            },
            "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
          }
        `)
    })
  })

  describe('getUninstrumentedFunctionConfig', () => {
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
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Runtime: 'go',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})
      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      await expect(
        getUninstrumentedFunctionConfig(lambda as any, cloudWatch as any, config, undefined)
      ).rejects.toThrow()
    })

    test('returns configurations without updateRequest when no changes need to be made', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          Environment: {
            Variables: {},
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})

      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      expect(
        (await getUninstrumentedFunctionConfig(lambda as any, cloudWatch as any, config, undefined)).updateRequest
      ).toBeUndefined()
    })

    test('returns log group configuration subscription delete request when forwarderARN is set', async () => {
      const logGroupName = '/aws/lambda/group'
      ;(loggroup.calculateLogGroupRemoveRequest as any).mockImplementation(() => ({
        filterName: SUBSCRIPTION_FILTER_NAME,
        logGroupName,
      }))

      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})
      const config = await getLambdaFunctionConfig(
        lambda as any,
        'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
      )
      const result = await getUninstrumentedFunctionConfig(
        lambda as any,
        cloudWatch as any,
        config,
        'valid-forwarder-arn'
      )
      expect(result).toBeDefined()
      expect(result.logGroupConfiguration).toMatchInlineSnapshot(`
        Object {
          "filterName": "${SUBSCRIPTION_FILTER_NAME}",
          "logGroupName": "${logGroupName}",
        }
      `)
    })
  })

  describe('getUninstrumentedFunctionConfigsFromRegEx', () => {
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
        'autoinstrument-scooby': {
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
          Runtime: 'nodejs12.x',
        },
        'autoinstrument-scrapy': {
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
          Runtime: 'nodejs12.x',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs({})
      const result = await getUninstrumentedFunctionConfigsFromRegEx(
        lambda as any,
        cloudWatch as any,
        'autoinstrument-scr.',
        undefined
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {},
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:autoinstrument-scrapy",
          "Handler": "index.handler",
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

      await expect(
        getUninstrumentedFunctionConfigsFromRegEx(lambda as any, cloudWatch as any, 'fake-pattern', undefined)
      ).rejects.toStrictEqual(new Error('Max retry count exceeded. ListFunctionsError'))
    })
  })
})
