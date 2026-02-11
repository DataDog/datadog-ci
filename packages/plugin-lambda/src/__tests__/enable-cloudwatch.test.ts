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
jest.mock('../renderers/cloudwatch-renderer', () => ({
  ...jest.requireActual('../renderers/cloudwatch-renderer'),
  processingFunctionsSpinner: jest.fn().mockReturnValue({start: jest.fn(), succeed: jest.fn(), fail: jest.fn()}),
}))
jest.mock('@datadog/datadog-ci-base/helpers/prompt')
jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

import * as fs from 'fs'

import {DeleteRolePolicyCommand, IAMClient} from '@aws-sdk/client-iam'
import {GetFunctionCommand, LambdaClient, ListFunctionsCommand} from '@aws-sdk/client-lambda'
import {fromNodeProviderChain} from '@aws-sdk/credential-providers'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {mockClient} from 'aws-sdk-client-mock'

import 'aws-sdk-client-mock-jest'

import {PluginCommand as EnableCloudwatchCommand} from '../commands/enable-cloudwatch'
import {DENY_CLOUDWATCH_POLICY_NAME} from '../functions/cloudwatch'

import {mockAwsCredentials} from './fixtures'

describe('lambda enable-cloudwatch', () => {
  const runCLI = makeRunCLI(EnableCloudwatchCommand, ['lambda', 'enable-cloudwatch'], {skipResetEnv: true})
  const lambdaClientMock = mockClient(LambdaClient)
  const iamClientMock = mockClient(IAMClient)

  beforeEach(() => {
    ;(fromNodeProviderChain as jest.Mock).mockReturnValue(jest.fn().mockResolvedValue(mockAwsCredentials))
  })

  describe('execute', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      lambdaClientMock.reset()
      iamClientMock.reset()
      jest.resetModules()
      process.env = {}

      lambdaClientMock.on(ListFunctionsCommand).resolves({Functions: []})
      iamClientMock.on(DeleteRolePolicyCommand).resolves({})
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns 1 when no functions are specified', async () => {
      const {code, context} = await runCLI([])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '[Error] No functions specified. Use -f, --function, or --functions-regex.\n'
      )
    })

    test('removes deny policy for a single function (dry run)', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:my-func'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func',
            FunctionName: 'my-func',
            Role: 'arn:aws:iam::123456789012:role/my-role',
          },
        })

      const {code, context} = await runCLI([
        '-f',
        'arn:aws:lambda:us-east-1:123456789012:function:my-func',
        '--dry-run',
      ])

      expect(code).toBe(0)
      expect(iamClientMock).not.toHaveReceivedCommand(DeleteRolePolicyCommand)
      expect(context.stdout.toString()).toBe(
        '\n[Dry Run] 🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '[Dry Run] Remove DenyCloudWatchLogs policy on role my-role for arn:aws:lambda:us-east-1:123456789012:function:my-func\n'
      )
    })

    test('removes deny policy for a single function', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:my-func'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func',
            FunctionName: 'my-func',
            Role: 'arn:aws:iam::123456789012:role/my-role',
          },
        })

      const {code, context} = await runCLI(['-f', 'arn:aws:lambda:us-east-1:123456789012:function:my-func'])

      expect(code).toBe(0)
      expect(iamClientMock).toHaveReceivedCommandWith(DeleteRolePolicyCommand, {
        RoleName: 'my-role',
        PolicyName: DENY_CLOUDWATCH_POLICY_NAME,
      })
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '✔ Removed DenyCloudWatchLogs policy on role my-role for arn:aws:lambda:us-east-1:123456789012:function:my-func\n'
      )
    })

    test('handles multiple functions across regions', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:func1'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:func1',
            FunctionName: 'func1',
            Role: 'arn:aws:iam::123456789012:role/role1',
          },
        })
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:eu-west-1:123456789012:function:func2'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:func2',
            FunctionName: 'func2',
            Role: 'arn:aws:iam::123456789012:role/role2',
          },
        })

      const {code, context} = await runCLI([
        '-f',
        'arn:aws:lambda:us-east-1:123456789012:function:func1',
        '-f',
        'arn:aws:lambda:eu-west-1:123456789012:function:func2',
      ])

      expect(code).toBe(0)
      expect(iamClientMock).toHaveReceivedCommandTimes(DeleteRolePolicyCommand, 2)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '✔ Removed DenyCloudWatchLogs policy on role role1 for arn:aws:lambda:us-east-1:123456789012:function:func1\n' +
          '✔ Removed DenyCloudWatchLogs policy on role role2 for arn:aws:lambda:eu-west-1:123456789012:function:func2\n'
      )
    })

    test('handles NoSuchEntity gracefully when policy does not exist', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:my-func'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func',
            FunctionName: 'my-func',
            Role: 'arn:aws:iam::123456789012:role/my-role',
          },
        })
      const noSuchEntityError = new Error('Policy not found')
      ;(noSuchEntityError as any).name = 'NoSuchEntityException'
      iamClientMock.on(DeleteRolePolicyCommand).rejects(noSuchEntityError)

      const {code, context} = await runCLI(['-f', 'arn:aws:lambda:us-east-1:123456789012:function:my-func'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '✔ Removed DenyCloudWatchLogs policy on role my-role for arn:aws:lambda:us-east-1:123456789012:function:my-func\n'
      )
    })

    test('handles function not found error', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:missing'})
        .rejects(new Error('Function not found'))

      const {code, context} = await runCLI(['-f', 'arn:aws:lambda:us-east-1:123456789012:function:missing'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '[Error] Failed processing arn:aws:lambda:us-east-1:123456789012:function:missing: Error: Function not found\n'
      )
    })

    test('handles IAM permission denied error', async () => {
      lambdaClientMock
        .on(GetFunctionCommand, {FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:my-func'})
        .resolves({
          Configuration: {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func',
            FunctionName: 'my-func',
            Role: 'arn:aws:iam::123456789012:role/my-role',
          },
        })
      iamClientMock.on(DeleteRolePolicyCommand).rejects(new Error('Access Denied'))

      const {code, context} = await runCLI(['-f', 'arn:aws:lambda:us-east-1:123456789012:function:my-func'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '[Error] Failed processing arn:aws:lambda:us-east-1:123456789012:function:my-func: Error: Access Denied\n'
      )
    })

    test('supports --functions-regex', async () => {
      lambdaClientMock.on(ListFunctionsCommand).resolves({
        Functions: [
          {FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func-1', FunctionName: 'my-func-1'},
          {FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func-2', FunctionName: 'my-func-2'},
          {FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:other', FunctionName: 'other'},
        ],
      })
      lambdaClientMock.on(GetFunctionCommand).resolves({
        Configuration: {
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-func-1',
          FunctionName: 'my-func-1',
          Role: 'arn:aws:iam::123456789012:role/my-role',
        },
      })

      const {code, context} = await runCLI(['--functions-regex', 'my-func', '-r', 'us-east-1'])

      expect(code).toBe(0)
      expect(iamClientMock).toHaveReceivedCommand(DeleteRolePolicyCommand)
      const output = context.stdout.toString()
      expect(output).toContain('Enabling CloudWatch Logs for Lambda functions')
      expect(output).toContain('Removed DenyCloudWatchLogs policy on role')
      expect(output).toContain('my-role')
    })

    test('returns error when both --function and --functions-regex are specified', async () => {
      const {code, context} = await runCLI([
        '-f',
        'arn:aws:lambda:us-east-1:123456789012:function:my-func',
        '--functions-regex',
        'my-func',
        '-r',
        'us-east-1',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toBe(
        '\n🐶 Enabling CloudWatch Logs for Lambda functions\n' +
          '[Error] "--functions" and "--functions-regex" should not be used at the same time.\n'
      )
    })
  })
})
