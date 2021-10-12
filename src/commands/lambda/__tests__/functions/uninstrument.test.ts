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
import {getFunctionConfigs} from '../../functions/uninstrument'
import {makeMockCloudWatchLogs, makeMockLambda} from '../fixtures'

describe('uninstrument', () => {
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
              USER_VARIABLE: 'shouldnt be deleted by instrumentation',
            },
          },
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: 'datadog_lambda.handler.handler',
          Runtime: 'python3.8',
        },
      })
      const cloudWatch = makeMockCloudWatchLogs()
      const result = await getFunctionConfigs(
        lambda as any,
        cloudWatch as any,
        ['arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'],
        undefined
      )
      expect(result.length).toEqual(1)
      expect(result[0].updateRequest).toMatchInlineSnapshot(`
        Object {
          "Environment": Object {
            "Variables": Object {
              "USER_VARIABLE": "shouldnt be deleted by instrumentation",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:autoinstrument",
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
      const cloudWatch = makeMockCloudWatchLogs()

      const result = await getFunctionConfigs(
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
  })
})
