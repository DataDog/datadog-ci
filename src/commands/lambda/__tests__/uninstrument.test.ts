jest.mock('fs')
jest.mock('@aws-sdk/credential-providers', () => ({
  ...jest.requireActual('@aws-sdk/credential-providers'),
  fromIni: jest.fn(),
}))
jest.mock('../prompt')
jest.mock('../renderers/instrument-uninstrument-renderer')
jest.mock('../../../helpers/prompt')
jest.mock('../../../../package.json', () => ({version: 'XXXX'}))

import * as fs from 'fs'

import {
  GetFunctionCommand,
  LambdaClient,
  ListFunctionsCommand,
  UpdateFunctionConfigurationCommand,
} from '@aws-sdk/client-lambda'
import {fromIni} from '@aws-sdk/credential-providers'
import {mockClient} from 'aws-sdk-client-mock'

import {ENVIRONMENT_ENV_VAR, SERVICE_ENV_VAR, SITE_ENV_VAR, VERSION_ENV_VAR} from '../../../constants'
import {createCommand, makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import {requestConfirmation} from '../../../helpers/prompt'

import 'aws-sdk-client-mock-jest'

import {
  APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR,
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  FLUSH_TO_LOG_ENV_VAR,
  LAMBDA_HANDLER_ENV_VAR,
  LOG_ENABLED_ENV_VAR,
  LOG_LEVEL_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  TRACE_ENABLED_ENV_VAR,
} from '../constants'
import {requestAWSCredentials, requestFunctionSelection} from '../prompt'
import {UninstrumentCommand} from '../uninstrument'

import {
  mockAwsAccessKeyId,
  mockAwsSecretAccessKey,
  mockLambdaClientCommands,
  mockLambdaConfigurations,
} from './fixtures'

describe('lambda', () => {
  const runCLI = makeRunCLI(UninstrumentCommand, ['lambda', 'uninstrument'], {skipResetEnv: true})
  const lambdaClientMock = mockClient(LambdaClient)

  describe('uninstrument', () => {
    describe('execute', () => {
      const OLD_ENV = process.env
      beforeEach(() => {
        lambdaClientMock.reset()
        mockLambdaClientCommands(lambdaClientMock)
        jest.resetModules()
        process.env = {}
      })
      afterAll(() => {
        process.env = OLD_ENV
      })

      test('prints dry run data for a valid uninstrumentation', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
            config: {
              Architectures: ['x86_64'],
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
                  [LOG_LEVEL_ENV_VAR]: 'debug',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [SERVICE_ENV_VAR]: 'middletier',
                  [SITE_ENV_VAR]: 'datadoghq.com',
                  [TRACE_ENABLED_ENV_VAR]: 'true',
                  [VERSION_ENV_VAR]: '0.2',
                  [APM_FLUSH_DEADLINE_MILLISECONDS_ENV_VAR]: '42',
                  [DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR]: 'false',
                  [DD_LLMOBS_ENABLED_ENV_VAR]: 'true',
                  [DD_LLMOBS_ML_APP_ENV_VAR]: 'my-ml-app',
                  USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
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

        const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
        process.env.DATADOG_API_KEY = '1234'
        const {code, context} = await runCLI(['-f', functionARN, '-r', 'us-east-1', '-d'])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          [Dry Run] 🐶 Uninstrumenting Lambda function

          [!] Functions to be updated:
          	- arn:aws:lambda:us-east-1:000000000000:function:uninstrument

          [Dry Run] Will apply the following updates:
          UpdateFunctionConfiguration -> arn:aws:lambda:us-east-1:000000000000:function:uninstrument
          {
            "FunctionName": "arn:aws:lambda:us-east-1:000000000000:function:uninstrument",
            "Handler": "lambda_function.lambda_handler",
            "Environment": {
              "Variables": {
                "USER_VARIABLE": "sh**********tion"
              }
            },
            "Layers": []
          }
          "
        `)
      })

      test('runs function update command for valid uninstrumentation', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:000000000000:function:uninstrument': {
            config: {
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
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

        const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:uninstrument'
        process.env.DATADOG_API_KEY = '1234'
        await runCLI(['-f', functionARN, '-r', 'us-east-1'])
        expect(lambdaClientMock).toHaveReceivedCommand(UpdateFunctionConfigurationCommand)
      })

      test('aborts early when the aws-sdk throws an error', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        lambdaClientMock.on(GetFunctionCommand).rejects('Lambda Failed')

        process.env = {}
        const command = createCommand(UninstrumentCommand)
        command['functions'] = ['my-func']
        command['region'] = 'us-east-1'

        const code = await command['execute']()
        expect(code).toBe(1)
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] Couldn't fetch Lambda functions. Error: Lambda Failed
          "
        `)
      })

      test("aborts early when function regions can't be found", async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        const {code, context} = await runCLI(['--function', 'my-func'])

        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatch(
          'No default region specified for ["my-func"]. Use -r, --region, or use a full functionARN'
        )
      })

      test('aborts early when no functions are specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        const {code, context} = await runCLI([])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] No functions specified to remove instrumentation.
          "
        `)
      })

      test('aborts early when no functions are specified while using config file', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        process.env = {}
        const command = createCommand(UninstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        await command['execute']()
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] No functions specified to remove instrumentation.
          "
        `)
      })

      test('aborts if functions and a pattern are set at the same time', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        process.env = {}
        let command = createCommand(UninstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch(
          'Functions in config file and "--functions-regex" should not be used at the same time.\n'
        )

        command = createCommand(UninstrumentCommand)
        command['region'] = 'ap-southeast-1'
        command['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch(
          '"--functions" and "--functions-regex" should not be used at the same time.\n'
        )
      })

      test('aborts if the regEx pattern is an ARN', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        process.env = {}
        const command = createCommand(UninstrumentCommand)
        command['region'] = 'ap-southeast-1'
        command['regExPattern'] = 'arn:aws:lambda:ap-southeast-1:123456789012:function:*'
        const code = await command['execute']()
        expect(code).toBe(1)
        expect(command.context.stdout.toString()).toMatch(`"--functions-regex" isn't meant to be used with ARNs.\n`)
      })

      test('aborts if the regEx pattern is set but no region is specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        process.env = {}
        const command = createCommand(UninstrumentCommand)
        command['regExPattern'] = 'my-function'
        const code = await command['execute']()
        expect(code).toBe(1)
        expect(command.context.stdout.toString()).toMatch('No default region specified. [-r,--region]')
      })

      test('aborts if the the aws-sdk fails', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        process.env = {}
        lambdaClientMock.on(ListFunctionsCommand).rejects('ListFunctionsError')
        const command = createCommand(UninstrumentCommand)
        command['region'] = 'ap-southeast-1'
        command['regExPattern'] = 'my-function'
        const code = await command['execute']()
        expect(code).toBe(1)
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] Couldn't fetch Lambda functions. Error: ListFunctionsError
          "
        `)
      })

      test('uninstrument multiple functions interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              Architectures: ['x86_64'],
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
                  [LOG_LEVEL_ENV_VAR]: 'debug',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [SERVICE_ENV_VAR]: 'middletier',
                  [SITE_ENV_VAR]: 'datadoghq.com',
                  [TRACE_ENABLED_ENV_VAR]: 'true',
                  [VERSION_ENV_VAR]: '0.2',
                  USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
                },
              },
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
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
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
            config: {
              Architectures: ['x86_64'],
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
                  [LOG_LEVEL_ENV_VAR]: 'debug',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [SERVICE_ENV_VAR]: 'middletier',
                  [SITE_ENV_VAR]: 'datadoghq.com',
                  [TRACE_ENABLED_ENV_VAR]: 'true',
                  [VERSION_ENV_VAR]: '0.2',
                },
              },
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
              FunctionName: 'lambda-hello-world-2',
              Handler: 'datadog_lambda.handler.handler',
              Layers: [
                {
                  Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Extension:11',
                  CodeSize: 0,
                  SigningJobArn: 'some-signing-job-arn',
                  SigningProfileVersionArn: 'some-signing-profile',
                },
                {
                  Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Python39:49',
                  CodeSize: 0,
                  SigningJobArn: 'some-signing-job-arn',
                  SigningProfileVersionArn: 'some-signing-profile',
                },
              ],
              Runtime: 'python3.9',
            },
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
        ])
        ;(requestConfirmation as any).mockImplementation(() => true)

        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('uninstrument multiple specified functions interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              Architectures: ['x86_64'],
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
                  [LOG_LEVEL_ENV_VAR]: 'debug',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [SERVICE_ENV_VAR]: 'middletier',
                  [SITE_ENV_VAR]: 'datadoghq.com',
                  [TRACE_ENABLED_ENV_VAR]: 'true',
                  [VERSION_ENV_VAR]: '0.2',
                  USER_VARIABLE: 'shouldnt be deleted by uninstrumentation',
                },
              },
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
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
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
            config: {
              Architectures: ['x86_64'],
              Environment: {
                Variables: {
                  [ENVIRONMENT_ENV_VAR]: 'staging',
                  [FLUSH_TO_LOG_ENV_VAR]: 'true',
                  [LAMBDA_HANDLER_ENV_VAR]: 'lambda_function.lambda_handler',
                  [LOG_ENABLED_ENV_VAR]: 'true',
                  [LOG_LEVEL_ENV_VAR]: 'debug',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [SERVICE_ENV_VAR]: 'middletier',
                  [SITE_ENV_VAR]: 'datadoghq.com',
                  [TRACE_ENABLED_ENV_VAR]: 'true',
                  [VERSION_ENV_VAR]: '0.2',
                },
              },
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
              FunctionName: 'lambda-hello-world-2',
              Handler: 'datadog_lambda.handler.handler',
              Layers: [
                {
                  Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Extension:11',
                  CodeSize: 0,
                  SigningJobArn: 'some-signing-job-arn',
                  SigningProfileVersionArn: 'some-signing-profile',
                },
                {
                  Arn: 'arn:aws:lambda:sa-east-1:000000000000:layer:Datadog-Python39:49',
                  CodeSize: 0,
                  SigningJobArn: 'some-signing-job-arn',
                  SigningProfileVersionArn: 'some-signing-profile',
                },
              ],
              Runtime: 'python3.9',
            },
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
        ])
        ;(requestConfirmation as any).mockImplementation(() => true)

        const {code, context} = await runCLI([
          '-i',
          '-f',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          '-f',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts if a problem occurs while setting the AWS credentials interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(requestAWSCredentials as any).mockImplementation(() => Promise.reject('Unexpected error'))
        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
          [Error] Unexpected error
          "
        `)
      })

      test('aborts if there are no functions to uninstrument in the user AWS account', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
        }

        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] Couldn't find any Lambda functions in the specified region.
          "
        `)
      })

      test('aborts early when the aws-sdk throws an error while uninstrumenting interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
        }

        lambdaClientMock.on(ListFunctionsCommand).rejects('ListFunctionsError')

        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] Couldn't fetch Lambda functions. Error: ListFunctionsError
          "
        `)
      })

      test('prints error when updating aws profile credentials fails', async () => {
        ;(fromIni as any).mockImplementation(() => {
          throw Error('Update failed!')
        })

        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const {code, context} = await runCLI(['-f', functionARN, '--profile', 'SOME-AWS-PROFILE'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Uninstrumenting Lambda function
          [Error] Error: Couldn't set AWS profile credentials. Update failed!
          "
        `)
      })

      test('prints which functions failed to uninstrument without aborting when at least one function was uninstrumented correctly', async () => {
        const failingLambdas = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
        ]
        const layers = [
          {
            Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:11',
            CodeSize: 0,
            SigningJobArn: 'some-signing-job-arn',
            SigningProfileVersionArn: 'some-signing-profile',
          },
        ]
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
              FunctionName: 'lambda-1-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
              Layers: layers,
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1',
              FunctionName: 'lambda-2-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
              Layers: layers,
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-3-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-3-us-east-1',
              FunctionName: 'lambda-3-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
              Layers: [
                {
                  Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:11',
                  CodeSize: 0,
                  SigningJobArn: 'some-signing-job-arn',
                  SigningProfileVersionArn: 'some-signing-profile',
                },
              ],
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
              FunctionName: 'lambda-1-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs16.x',
              Layers: layers,
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-2-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-2-us-east-2',
              FunctionName: 'lambda-2-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
              Layers: layers,
            },
          },
        })

        for (const failingLambda of failingLambdas) {
          lambdaClientMock
            .on(UpdateFunctionConfigurationCommand, {FunctionName: failingLambda})
            .rejects('Unexpected error updating request')
        }

        const {code, context} = await runCLI([
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-3-us-east-1',
          '-f',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
          '-f',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-2-us-east-2',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts when every lambda function fails to update on uninstrument', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const layers = [
          {
            Arn: 'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:11',
            CodeSize: 0,
            SigningJobArn: 'some-signing-job-arn',
            SigningProfileVersionArn: 'some-signing-profile',
          },
        ]
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
              FunctionName: 'lambda-1-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
              Layers: layers,
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
              FunctionName: 'lambda-1-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
              Layers: layers,
            },
          },
        })

        lambdaClientMock.on(UpdateFunctionConfigurationCommand).rejects('Unexpected error updating request')

        const {code, context} = await runCLI([
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
          '-f',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toContain(`✖ Failed updating every Lambda function.`)
      })
    })

    describe('printPlannedActions', () => {
      test('prints no output when list is empty', () => {
        process.env = {}
        const command = createCommand(UninstrumentCommand)

        command['printPlannedActions']([])
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          No updates will be applied.
          "
        `)
      })
    })
  })
})
