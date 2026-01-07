jest.mock('fs', () => ({
  ...jest.createMockFromModule<typeof fs>('fs'),
  promises: {
    readFile: jest.fn().mockResolvedValue(''),
  },
}))
jest.mock('@aws-sdk/credential-providers', () => ({
  ...jest.requireActual('@aws-sdk/credential-providers'),
  fromIni: jest.fn(),
  fromNodeProviderChain: jest.fn(),
}))
jest.mock('../prompt')
jest.mock('../renderers/instrument-uninstrument-renderer')
jest.mock('@datadog/datadog-ci-base/helpers/prompt')
jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

import * as fs from 'fs'

import {LambdaClient, ListFunctionsCommand, UpdateFunctionConfigurationCommand} from '@aws-sdk/client-lambda'
import {fromIni, fromNodeProviderChain} from '@aws-sdk/credential-providers'
import {createCommand, makeRunCLI, MOCK_DATADOG_API_KEY} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {requestConfirmation} from '@datadog/datadog-ci-base/helpers/prompt'
import {
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import * as instrumentHelpers from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {mockClient} from 'aws-sdk-client-mock'
import 'aws-sdk-client-mock-jest'
import {Cli} from 'clipanion'

import {PluginCommand as InstrumentCommand} from '../commands/instrument'
import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SESSION_TOKEN_ENV_VAR,
  DEFAULT_LAYER_AWS_ACCOUNT,
} from '../constants'
import {InstrumentationSettings, LambdaConfigOptions} from '../interfaces'
import {
  requestAWSCredentials,
  requestDatadogEnvVars,
  requestEnvServiceVersion,
  requestFunctionSelection,
} from '../prompt'

import {
  mockAwsAccessKeyId,
  mockAwsCredentials,
  mockAwsSecretAccessKey,
  mockDatadogEnv,
  mockDatadogService,
  mockDatadogVersion,
  mockLambdaClientCommands,
  mockLambdaConfigurations,
  mockLambdaLayers,
} from './fixtures'

describe('lambda', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['lambda', 'instrument'], {skipResetEnv: true})
  const lambdaClientMock = mockClient(LambdaClient)

  beforeEach(() => {
    ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(mockAwsCredentials))
  })

  describe('instrument', () => {
    describe('execute', () => {
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

      test('prints dry run data for lambda library layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })

        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '--layerVersion',
          '10',
          '--extensionVersion',
          'none',
          '--logLevel',
          'debug',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--extra-tags',
          'layer:api,team:intake',
          '--no-source-code-integration',
          '--llmobs',
          'my-ml-app',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('prints dry run data for lambda library and extension layers using kebab case args', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--extra-tags',
          'layer:api,team:intake',
          '--layer-version',
          '10',
          '--extension-version',
          '5',
          '--merge-xray-traces',
          'true',
          '--flush-metrics-to-logs',
          'false',
          '--log-level',
          'debug',
          '--no-source-code-integration',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('prints dry run data for lambda extension layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '--extensionVersion',
          '6',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--extra-tags',
          'layer:api,team:intake',
          '--no-source-code-integration',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('prints dry run data for lambda .NET layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'dotnet8',
            },
          },
        })
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '-v',
          '129',
          '--extra-tags',
          'layer:api,team:intake',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('instrumenting with source code integrations fails if not run within a git repo', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {context} = await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '-s',
          '--service',
          'dummy',
          '--env',
          'dummy',
          '--version',
          '0.1',
        ])
        expect(context.stdout.toString().replace('\n', '')).toMatch(/.*Error: Couldn't get local git status.*/)
      })

      test('ensure the instrument command ran from a dirty git repo fails', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentHelpers as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 0,
          isClean: false,
        }))

        const cli = new Cli()
        cli.register(instrumentCommand)

        const {context} = await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '-s',
          '--service',
          'dummy',
          '--env',
          'dummy',
          '--version',
          '0.1',
        ])
        expect(context.stdout.toString()).toMatch('Error: Local git repository is dirty')
      })

      test('ensure source code integration flag works from a clean repo', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentHelpers, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(async () => ({
          ahead: 0,
          hash: '1be168ff837f043bde17c0314341c84271047b31',
          remote: 'git.repository_url:git@github.com:datadog/test.git',
          isClean: true,
          files: [],
        }))
        const mockUploadFunction = jest.spyOn(instrumentHelpers as any, 'uploadGitData')
        mockUploadFunction.mockImplementation(() => {
          return
        })

        const cli = new Cli()
        cli.register(instrumentCommand)

        const {context} = await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '-s',
          '--service',
          'dummy',
          '--env',
          'dummy',
          '--version',
          '0.1',
        ])
        expect(context.stdout.toString()).toMatchSnapshot()
        expect(mockUploadFunction).toHaveBeenCalledTimes(1)
      })

      test('ensure no git metadata upload flag works', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentHelpers as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 0,
          hash: '1be168ff837f043bde17c0314341c84271047b31',
          remote: 'git.repository_url:git@github.com:datadog/test.git',
          isClean: true,
          files: [],
        }))
        const mockUploadFunction = jest.spyOn(instrumentHelpers as any, 'uploadGitData')
        mockUploadFunction.mockImplementation(async () => {
          return
        })

        const cli = new Cli()
        cli.register(instrumentCommand)

        const {context} = await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '--no-upload-git-metadata',
          '--service',
          'dummy',
          '--env',
          'dummy',
          '--version',
          '0.1',
        ])
        expect(mockUploadFunction).toHaveBeenCalledTimes(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('ensure the instrument command ran from a local git repo ahead of the origin fails', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const instrumentCommand = InstrumentCommand
        const mockGitStatus = jest.spyOn(instrumentHelpers as any, 'getCurrentGitStatus')
        mockGitStatus.mockImplementation(() => ({
          ahead: 1,
          isClean: true,
          files: [],
          hash: '',
          remote: '',
        }))

        const cli = new Cli()
        cli.register(instrumentCommand)

        const {context} = await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '-s',
          '--service',
          'dummy',
          '--env',
          'dummy',
          '--version',
          '0.1',
        ])
        expect(context.stdout.toString()).toMatch(
          'Error: Local changes have not been pushed remotely. Aborting git data tagging.'
        )
      })

      test('runs function update command for lambda library layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
        })
        await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--layerVersion',
          '10',
          '--extensionVersion',
          'none',
          '--no-source-code-integration',
        ])
        expect(lambdaClientMock).toHaveReceivedCommand(UpdateFunctionConfigurationCommand)
      })

      test('runs function update command for lambda extension layer', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        await runCLI([
          '--function',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          '--extensionVersion',
          '6',
          '--no-source-code-integration',
        ])

        expect(lambdaClientMock).toHaveReceivedCommand(UpdateFunctionConfigurationCommand)
      })

      test('aborts early when no functions are specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const {code, context} = await runCLI([
          '--layerVersion',
          '10',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function
          [Error] No functions specified to instrument.
          "
        `)
      })

      test('aborts early when no functions are specified while using config file', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['layerVersion'] = '60'
        command['config']['extensionVersion'] = '10'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['service'] = 'middletier'
        command['config']['environment'] = 'staging'
        command['config']['version'] = '0.2'

        await command['execute']()

        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function
          [Error] No functions specified to instrument.
          "
        `)
      })

      test("aborts early when function regions can't be found", async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const {code, context} = await runCLI([
          '--function',
          'my-func',
          '--layerVersion',
          '10',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])

        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatch(
          `Couldn't group functions. Error: No default region specified for ["my-func"]. Use -r, --region, or use a full functionARN\n`
        )
      })

      test('aborts early when extensionVersion and forwarder are set', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const {code, context} = await runCLI([
          '--function',
          'test-function-arn',
          '--forwarder',
          'arn:aws:lambda:sa-east-1:000000000000:function:datadog-forwarder',
          '--extensionVersion',
          '6',
          '--region',
          'us-east-1',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function
          [Error] "extensionVersion" and "forwarder" should not be used at the same time.
          "
        `)
      })

      test('check if functions are not empty while using config file', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['layerVersion'] = '60'
        command['config']['extensionVersion'] = '10'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        await command['execute']()
        expect(command['config']['functions']).toHaveLength(1)
      })

      test('aborts if functions and a pattern are set at the same time', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        let command = createCommand(InstrumentCommand)
        command['config']['environment'] = 'staging'
        command['config']['service'] = 'middletier'
        command['config']['version'] = '2'
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        command['sourceCodeIntegration'] = false
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch(
          'Functions in config file and "--functions-regex" should not be used at the same time.\n'
        )

        command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['region'] = 'ap-southeast-1'
        command['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['regExPattern'] = 'valid-pattern'
        command['sourceCodeIntegration'] = false
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch(
          '"--functions" and "--functions-regex" should not be used at the same time.\n'
        )
      })

      test('aborts if pattern is set and no default region is specified', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}

        const command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['regExPattern'] = 'valid-pattern'
        command['sourceCodeIntegration'] = false
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch('[Error] No default region specified. [-r,--region]\n')
      })

      test('aborts if the regEx pattern is an ARN', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['environment'] = 'staging'
        command['service'] = 'middletier'
        command['version'] = '2'
        command['region'] = 'ap-southeast-1'
        command['regExPattern'] = 'arn:aws:lambda:ap-southeast-1:123456789012:function:*'
        command['sourceCodeIntegration'] = false
        await command['execute']()
        expect(command.context.stdout.toString()).toMatch(`"--functions-regex" isn't meant to be used with ARNs.\n`)
      })

      test('instrument multiple functions interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(undefined))
        const node24LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node24-x`
        const node22LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node22-x`
        const node20LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node20-x`
        const node18LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node18-x`
        const node16LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node16-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs16.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
              FunctionName: 'lambda-hello-world-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3',
              FunctionName: 'lambda-hello-world-3',
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-4': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-4',
              FunctionName: 'lambda-hello-world-4',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-5': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-5',
              FunctionName: 'lambda-hello-world-5',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        mockLambdaLayers(lambdaClientMock, {
          [`${node16LibraryLayer}:1`]: {
            LayerName: `${node16LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node18LibraryLayer}:1`]: {
            LayerName: `${node18LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node20LibraryLayer}:1`]: {
            LayerName: `${node20LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node22LibraryLayer}:1`]: {
            LayerName: `${node22LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node24LibraryLayer}:1`]: {
            LayerName: `${node24LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${extensionLayer}:1`]: {
            LayerName: `${extensionLayer}`,
            VersionNumber: 1,
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
        ])
        ;(requestConfirmation as any).mockImplementation(() => true)

        const {code, context} = await runCLI(['-i', '--no-source-code-integration'])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('instrument multiple specified functions interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(undefined))
        const node16LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node16-x`
        const node18LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node18-x`
        const node20LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node20-x`
        const node22LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node22-x`
        const node24LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node24-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs16.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
              FunctionName: 'lambda-hello-world-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-3',
              FunctionName: 'lambda-hello-world-3',
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-4': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-4',
              FunctionName: 'lambda-hello-world-4',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-5': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-5',
              FunctionName: 'lambda-hello-world-5',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        mockLambdaLayers(lambdaClientMock, {
          [`${node16LibraryLayer}:1`]: {
            LayerName: `${node16LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node18LibraryLayer}:1`]: {
            LayerName: `${node18LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node20LibraryLayer}:1`]: {
            LayerName: `${node20LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node22LibraryLayer}:1`]: {
            LayerName: `${node22LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${node24LibraryLayer}:1`]: {
            LayerName: `${node24LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${extensionLayer}:1`]: {
            LayerName: `${extensionLayer}`,
            VersionNumber: 1,
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
          process.env[AWS_SESSION_TOKEN_ENV_VAR] = 'some-session-token'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
        })
        ;(requestConfirmation as any).mockImplementation(() => true)

        const {code, context} = await runCLI([
          '-i',
          '-f',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
          '-f',
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world-2',
          '--no-source-code-integration',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts if a problem occurs while setting the AWS credentials interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(undefined))
        ;(requestAWSCredentials as any).mockImplementation(() => Promise.reject('Unexpected error'))
        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function
          [!] No AWS credentials found, let's set them up! Or you can re-run the command and supply the AWS credentials in the same way when you invoke the AWS CLI.
          [Error] Unexpected error
          "
        `)
      })

      test('aborts if a problem occurs while setting the Datadog Environment Variables interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa,-east-1',
        }
        ;(requestDatadogEnvVars as any).mockImplementation(() => Promise.reject('Unexpected error'))
        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function

          [!] Configure AWS region.

          [!] Configure Datadog settings.
          [Error] Unexpected error
          "
        `)
      })

      test('when provided it sets DD_ENV, DD_SERVICE, and DD_VERSION environment variables in interactive mode', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(undefined))
        const node24LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node24-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })

        mockLambdaLayers(lambdaClientMock, {
          [`${node24LibraryLayer}:1`]: {
            LayerName: `${node24LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${extensionLayer}:1`]: {
            LayerName: `${extensionLayer}`,
            VersionNumber: 1,
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        ])
        ;(requestConfirmation as any).mockImplementation(() => true)
        ;(requestEnvServiceVersion as any).mockImplementation(() => {
          process.env[ENVIRONMENT_ENV_VAR] = mockDatadogEnv
          process.env[SERVICE_ENV_VAR] = mockDatadogService
          process.env[VERSION_ENV_VAR] = mockDatadogVersion
        })

        const {code, context} = await runCLI(['-i', '--no-source-code-integration'])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('when not provided it does not set DD_ENV, DD_SERVICE, and DD_VERSION tags in interactive mode', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(undefined))
        const node24LibraryLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node24-x`
        const extensionLayer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
              FunctionName: 'lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })
        mockLambdaLayers(lambdaClientMock, {
          [`${node24LibraryLayer}:1`]: {
            LayerName: `${node24LibraryLayer}`,
            VersionNumber: 1,
          },
          [`${extensionLayer}:1`]: {
            LayerName: `${extensionLayer}`,
            VersionNumber: 1,
          },
        })
        ;(requestAWSCredentials as any).mockImplementation(() => {
          process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = mockAwsAccessKeyId
          process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = mockAwsSecretAccessKey
          process.env[AWS_DEFAULT_REGION_ENV_VAR] = 'sa-east-1'
        })
        ;(requestDatadogEnvVars as any).mockImplementation(() => {
          process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
          process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
        })
        ;(requestFunctionSelection as any).mockImplementation(() => [
          'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        ])
        ;(requestConfirmation as any).mockImplementation(() => true)
        ;(requestEnvServiceVersion as any).mockImplementation(() => {
          process.env[ENVIRONMENT_ENV_VAR] = undefined
          process.env[SERVICE_ENV_VAR] = undefined
          process.env[VERSION_ENV_VAR] = undefined
        })

        const {code, context} = await runCLI(['-i', '--no-source-code-integration'])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts if there are no functions to instrument in the user AWS account', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
          [CI_SITE_ENV_VAR]: 'datadoghq.com',
          [CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY,
        }

        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function

          [!] Configure AWS region.
          [Error] Couldn't find any Lambda functions in the specified region.
          "
        `)
      })

      test('aborts early when the aws-sdk throws an error while instrumenting interactively', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
          [CI_SITE_ENV_VAR]: 'datadoghq.com',
          [CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY,
        }

        lambdaClientMock.on(ListFunctionsCommand).rejects('ListFunctionsError')

        const {code, context} = await runCLI(['-i'])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          🐶 Instrumenting Lambda function

          [!] Configure AWS region.
          [Error] Couldn't fetch Lambda functions. Error: ListFunctionsError
          "
        `)
      })

      test('instruments Ruby application properly', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:ruby32': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby32',
              Runtime: 'ruby3.2',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:ruby32arm': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby32arm',
              Runtime: 'ruby3.2',
              Architectures: ['arm64'],
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:ruby33': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby33',
              Runtime: 'ruby3.3',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:ruby33arm': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby33arm',
              Runtime: 'ruby3.3',
              Architectures: ['arm64'],
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:ruby34': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby34',
              Runtime: 'ruby3.4',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:ruby34arm': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:ruby34arm',
              Runtime: 'ruby3.4',
              Architectures: ['arm64'],
            },
          },
        })

        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby32',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby33',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby32arm',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby33arm',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby34',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:ruby34arm',
          '--dry-run',
          '-e',
          '40',
          '-v',
          '19',
          '--extra-tags',
          'layer:api,team:intake',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])

        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('instruments image runtimes properly', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:provided-al2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:provided-al2',
              Runtime: 'provided.al2',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:provided-al2023': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:provided-al2023',
              Runtime: 'provided.al2023',
              Architectures: ['arm64'],
            },
          },
        })

        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:provided-al2',
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:provided-al2023',
          '--dry-run',
          '-e',
          '40',
          '--layerVersion',
          'none',
          '--extra-tags',
          'layer:api,team:intake',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])

        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts early when a layer version is set for a Custom runtime', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'provided.al2',
            },
          },
        })
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '-v',
          '6',
          '--extra-tags',
          'layer:api,team:intake',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          [Dry Run] 🐶 Instrumenting Lambda function
          [Error] Couldn't fetch Lambda functions. Error: Only the --extension-version argument should be set for the provided.al2 runtime. Please remove the --layer-version argument from the instrument command.
          "
        `)
      })

      test('succeeds when custom runtime is used without layer version', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: functionARN,
              Runtime: 'provided.al2',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code} = await runCLI(['-f', functionARN, '--no-source-code-integration'])
        expect(code).toBe(0)
      })

      test('fails when custom runtime is used with a numeric layer version', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: functionARN,
              Runtime: 'provided.al2',
            },
          },
        })
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--no-source-code-integration',
          '--layer-version',
          '10',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toContain(
          "[Error] Couldn't fetch Lambda functions. Error: Only the --extension-version argument should be set for the provided.al2 runtime. Please remove the --layer-version argument from the instrument command."
        )
      })

      test('aborts early when .NET is using ARM64 architecture', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              Architectures: ['arm64'],
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Runtime: 'dotnet6',
            },
          },
        })

        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        process.env.DATADOG_API_KEY = MOCK_DATADOG_API_KEY
        const {code, context} = await runCLI([
          '-f',
          functionARN,
          '--dry-run',
          '-v',
          '6',
          '--extensionVersion',
          '20',
          '--extra-tags',
          'layer:api,team:intake',
          '--service',
          'middletier',
          '--env',
          'staging',
          '--version',
          '0.2',
          '--no-source-code-integration',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchInlineSnapshot(`
          "
          [Dry Run] 🐶 Instrumenting Lambda function
          [Error] Couldn't fetch Lambda functions. Error: Instrumenting arm64 architecture is not supported for the given dd-extension version. Please choose the latest dd-extension version or use x86_64 architecture.
          "
        `)
      })

      test('instruments correctly with profile when provided', async () => {
        const credentials = mockAwsCredentials

        ;(fromIni as any).mockImplementation((_init: string) => async () => Promise.resolve(credentials))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
              Handler: 'index.handler',
              Runtime: 'nodejs24.x',
            },
          },
        })

        const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
        const {code} = await runCLI([
          '-f',
          functionARN,
          '--profile',
          'SOME-AWS-PROFILE',
          '--extensionVersion',
          'none',
          '--layerVersion',
          'none',
          '--no-source-code-integration',
        ])
        expect(code).toBe(0)
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
          🐶 Instrumenting Lambda function
          [Error] Error: Couldn't set AWS profile credentials. Update failed!
          "
        `)
      })

      test('prints which functions failed to instrument without aborting when at least one function was instrumented correctly', async () => {
        const failingLambdas = [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
        ]
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
              FunctionName: 'lambda-1-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-2-us-east-1',
              FunctionName: 'lambda-2-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-3-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-3-us-east-1',
              FunctionName: 'lambda-3-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
              FunctionName: 'lambda-1-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs16.x',
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-2-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-2-us-east-2',
              FunctionName: 'lambda-2-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
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
          '--extensionVersion',
          'none',
          '--layerVersion',
          'none',
        ])
        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()
      })

      test('aborts when every lambda function fails to update on instrument', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        mockLambdaConfigurations(lambdaClientMock, {
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
              FunctionName: 'lambda-1-us-east-1',
              Handler: 'index.handler',
              Runtime: 'nodejs22.x',
            },
          },
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2': {
            config: {
              FunctionArn: 'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
              FunctionName: 'lambda-1-us-east-2',
              Handler: 'index.handler',
              Runtime: 'nodejs18.x',
            },
          },
        })

        lambdaClientMock.on(UpdateFunctionConfigurationCommand).rejects('Unexpected error updating request')

        const {code, context} = await runCLI([
          '-f',
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-1-us-east-1',
          '-f',
          'arn:aws:lambda:us-east-2:123456789012:function:lambda-1-us-east-2',
          '--extensionVersion',
          'none',
          '--layerVersion',
          'none',
        ])
        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchSnapshot()
      })
    })

    describe('getSettings', () => {
      beforeEach(() => {
        lambdaClientMock.reset()
      })

      test('uses config file settings', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['flushMetricsToLogs'] = 'false'
        command['config']['forwarder'] = 'my-forwarder'
        command['config']['layerVersion'] = '2'
        command['config']['extensionVersion'] = '6'
        command['config']['layerAWSAccount'] = 'another-account'
        command['config']['mergeXrayTraces'] = 'false'
        command['config']['tracing'] = 'false'
        command['config']['logging'] = 'false'
        command['config']['logLevel'] = 'debug'
        command['config']['llmobs'] = 'my-ml-app'

        expect(command['getSettings']()).toEqual({
          appsecEnabled: false,
          apmFlushDeadline: undefined,
          captureLambdaPayload: false,
          environment: undefined,
          extensionVersion: 6,
          extraTags: undefined,
          lambdaFips: false,
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          interactive: false,
          layerAWSAccount: 'another-account',
          layerVersion: 2,
          loggingEnabled: false,
          logLevel: 'debug',
          mergeXrayTraces: false,
          service: undefined,
          tracingEnabled: false,
          version: undefined,
          llmobsMlApp: 'my-ml-app',
        })
      })

      test('prefers command line arguments over config file', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['forwarder'] = 'my-forwarder'
        command['config']['forwarder'] = 'another-forwarder'
        command['layerVersion'] = '1'
        command['config']['layerVersion'] = '2'
        command['layerAWSAccount'] = 'my-account'
        command['config']['layerAWSAccount'] = 'another-account'
        command['mergeXrayTraces'] = 'true'
        command['config']['mergeXrayTraces'] = 'false'
        command['flushMetricsToLogs'] = 'false'
        command['config']['flushMetricsToLogs'] = 'true'
        command['tracing'] = 'true'
        command['config']['tracing'] = 'false'
        command['logging'] = 'true'
        command['config']['logging'] = 'false'
        command['logLevel'] = 'debug'
        command['config']['logLevel'] = 'info'
        command['apmFlushDeadline'] = '20'
        command['config']['apmFlushDeadline'] = '50'
        command['llmobs'] = 'my-ml-app'
        command['config']['llmobs'] = 'another-ml-app'

        expect(command['getSettings']()).toEqual({
          appsecEnabled: false,
          apmFlushDeadline: '20',
          captureLambdaPayload: false,
          environment: undefined,
          extensionVersion: 'latest',
          extraTags: undefined,
          lambdaFips: false,
          flushMetricsToLogs: false,
          forwarderARN: 'my-forwarder',
          interactive: false,
          layerAWSAccount: 'my-account',
          layerVersion: 1,
          loggingEnabled: true,
          logLevel: 'debug',
          mergeXrayTraces: true,
          service: undefined,
          tracingEnabled: true,
          version: undefined,
          llmobsMlApp: 'my-ml-app',
        })
      })

      test("returns undefined when layer version can't be parsed", () => {
        process.env = {}

        const command = createCommand(InstrumentCommand)
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['layerVersion'] = 'abd'

        expect(command['getSettings']()).toBeUndefined()
      })

      test("returns undefined when extension version can't be parsed", () => {
        process.env = {}

        const command = createCommand(InstrumentCommand)
        command.context = {
          stdout: {write: jest.fn()} as any,
        } as any
        command['extensionVersion'] = 'abd'

        expect(command['getSettings']()).toBeUndefined()
      })

      test('converts string boolean from command line and config file correctly', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)
        const validSettings: InstrumentationSettings = {
          apmFlushDeadline: undefined,
          appsecEnabled: false,
          captureLambdaPayload: true,
          environment: undefined,
          extensionVersion: 'latest',
          extraTags: undefined,
          lambdaFips: false,
          flushMetricsToLogs: false,
          forwarderARN: undefined,
          interactive: false,
          layerAWSAccount: undefined,
          layerVersion: 'latest',
          llmobsMlApp: undefined,
          loggingEnabled: true,
          logLevel: undefined,
          mergeXrayTraces: false,
          service: undefined,
          tracingEnabled: true,
          version: undefined,
        }
        command['config']['captureLambdaPayload'] = 'truE'
        command['config']['flushMetricsToLogs'] = 'False'
        command['config']['logging'] = 'trUe'
        command['config']['mergeXrayTraces'] = 'falSE'
        command['config']['tracing'] = 'TRUE'

        expect(command['getSettings']()).toEqual(validSettings)

        command['config']['captureLambdaPayload'] = 'true'
        command['config']['flushMetricsToLogs'] = 'false'
        command['config']['logging'] = 'true'
        command['config']['mergeXrayTraces'] = 'false'
        command['config']['tracing'] = 'true'
        expect(command['getSettings']()).toEqual(validSettings)

        validSettings.captureLambdaPayload = false
        validSettings.flushMetricsToLogs = true
        validSettings.loggingEnabled = false
        validSettings.mergeXrayTraces = true
        validSettings.tracingEnabled = false

        command['captureLambdaPayload'] = 'faLSE'
        command['flushMetricsToLogs'] = 'truE'
        command['logging'] = 'FALse'
        command['mergeXrayTraces'] = 'TRUe'
        command['tracing'] = 'FALSE'
        expect(command['getSettings']()).toEqual(validSettings)

        command['captureLambdaPayload'] = 'false'
        command['flushMetricsToLogs'] = 'true'
        command['logging'] = 'false'
        command['mergeXrayTraces'] = 'true'
        command['tracing'] = 'false'
        expect(command['getSettings']()).toEqual(validSettings)
      })

      test('aborts early if converting string boolean has an invalid value', () => {
        process.env = {}
        const stringBooleans: (keyof Omit<LambdaConfigOptions, 'functions' | 'interactive' | 'appsecEnabled'>)[] = [
          'flushMetricsToLogs',
          'logging',
          'mergeXrayTraces',
          'tracing',
        ]
        for (const option of stringBooleans) {
          let command = createCommand(InstrumentCommand)
          command['config'][option] = 'NotBoolean'
          command['getSettings']()

          expect(command.context.stdout.toString()).toMatch(`[Error] Invalid boolean specified for ${option}.\n`)

          command = createCommand(InstrumentCommand)
          command[option] = 'NotBoolean'
          command['getSettings']()

          expect(command.context.stdout.toString()).toMatch(`Invalid boolean specified for ${option}.\n`)
        }
      })

      test('warns if any of environment, service or version tags are not set', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        let command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['getSettings']()
        expect(command.context.stdout.toString()).toMatch(
          '[Warning] The environment, service and version tags have not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.\n'
        )

        command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['config']['environment'] = 'b'
        command['config']['service'] = 'middletier'
        command['getSettings']()
        expect(command.context.stdout.toString()).toMatch(
          '[Warning] The version tag has not been configured. Learn more about Datadog unified service tagging: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/#serverless-environment.\n'
        )
      })

      test('aborts early if extraTags do not comply with expected key:value list', async () => {
        ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
        process.env = {}
        const command = createCommand(InstrumentCommand)
        command['config']['region'] = 'ap-southeast-1'
        command['config']['functions'] = ['arn:aws:lambda:ap-southeast-1:123456789012:function:lambda-hello-world']
        command['config']['service'] = 'middletier'
        command['config']['environment'] = 'staging'
        command['config']['version'] = '0.2'
        command['config']['extraTags'] = 'not@complying:illegal-chars-in-key,complies:valid-pair'
        command['getSettings']()
        expect(command.context.stdout.toString()).toMatch(
          '[Error] Extra tags do not comply with the <key>:<value> array.\n'
        )
      })
    })
    describe('printPlannedActions', () => {
      test('prints no output when list is empty', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)

        command['printPlannedActions']([])
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          No updates will be applied.
          "
        `)
      })

      test('prints log group actions', () => {
        process.env = {}
        const command = createCommand(InstrumentCommand)

        command['printPlannedActions']([
          {
            functionARN: 'my-func',
            lambdaConfig: {} as any,
            logGroupConfiguration: {
              createLogGroupCommandInput: {logGroupName: 'my-log-group'} as any,
              deleteSubscriptionFilterCommandInput: {filterName: 'my-filter'} as any,
              logGroupName: 'my-log-group',
              putSubscriptionFilterCommandInput: {filterName: 'my-filter'} as any,
            },
          },
        ])
        expect(command.context.stdout.toString()).toMatchInlineSnapshot(`
          "
          [Warning] Instrument your Lambda functions in a dev or staging environment first. Should the instrumentation result be unsatisfactory, run \`uninstrument\` with the same arguments to revert the changes.

          [!] Functions to be updated:
          	- my-func

          Will apply the following updates:
          CreateLogGroup -> my-log-group
          {
            "logGroupName": "my-log-group"
          }
          DeleteSubscriptionFilter -> my-log-group
          {
            "filterName": "my-filter"
          }
          PutSubscriptionFilter -> my-log-group
          {
            "filterName": "my-filter"
          }
          "
        `)
      })
    })
  })
})
