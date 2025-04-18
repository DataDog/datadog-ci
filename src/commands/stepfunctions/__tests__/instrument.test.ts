import {LogLevel} from '@aws-sdk/client-sfn'

import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import * as aws from '../awsCommands'
import * as helpers from '../helpers'
import {InstrumentStepFunctionsCommand} from '../instrument'

import {describeStateMachineFixture, stepFunctionTagListFixture} from './fixtures/aws-resources'

jest.mock('../../../../package.json', () => ({version: '2.0.0'}))

describe('stepfunctions instrument test', () => {
  const runCLI = makeRunCLI(InstrumentStepFunctionsCommand, ['stepfunctions', 'instrument'])

  beforeAll(() => {
    jest.spyOn(helpers, 'injectContextIntoTasks').mockImplementation()
  })
  beforeEach(() => {
    const describeStateMachineCommandOutput = describeStateMachineFixture()
    jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(describeStateMachineCommandOutput)

    const stepFunctionTagList = [{key: 'env', value: 'test'}]
    jest.spyOn(aws, 'listTagsForResource').mockResolvedValue({tags: stepFunctionTagList} as any)

    jest.spyOn(aws, 'tagResource').mockResolvedValue({} as any)
    jest.spyOn(aws, 'createLogGroup').mockResolvedValue({} as any)
    jest.spyOn(aws, 'putSubscriptionFilter').mockResolvedValue({} as any)
    jest.spyOn(aws, 'createLogsAccessPolicy').mockResolvedValue({} as any)
    jest.spyOn(aws, 'attachPolicyToStateMachineIamRole').mockResolvedValue({} as any)
    jest.spyOn(aws, 'enableStepFunctionLogs').mockResolvedValue({} as any)
    jest.spyOn(aws, 'putSubscriptionFilter').mockResolvedValue({} as any)
  })

  describe('parameter validation', () => {
    test('errors if forwarder arn is not set', async () => {
      const {code, context} = await runCLI([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] `--forwarder` is required')
    })

    test('errors if forwarder arn is invalid', async () => {
      const {code, context} = await runCLI(['--forwarder', 'bla:'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] Invalid arn format for `--forwarder` bla:\n')
    })

    test('errors if no step function arn', async () => {
      const {code, context} = await runCLI(['--forwarder', 'arn:aws:lambda:sa-east-1:601427279990:function:hello'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] Must specify at least one `--step-function`')
    })

    test('errors if any step function arn is invalid', async () => {
      const {code, context} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:sa-east-1:601427279990:function:hello',
        '--step-function',
        'bla',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] Invalid arn format for `--step-function` bla')
    })

    test('errors if no env tag on step function and env parameter not set', async () => {
      jest.spyOn(aws, 'listTagsForResource').mockResolvedValue({tags: []} as any)

      const {code, context} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] --env is required when a Step Function has no env tag')
    })
  })

  describe('stepfunctions command overall test', () => {
    test('all aws commands are called when log level is OFF', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockImplementation(() => describeStateMachineCommandOutput as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--env',
        'test',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(1)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(1)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)

      expect(code).toBe(0)
    })

    test('all aws commands are called the same times when as log-level-off state machines', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockImplementation(() => describeStateMachineCommandOutput as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction222',
        '--env',
        'test',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(2)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(2)
      expect(aws.tagResource).toHaveBeenCalledTimes(2)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(2)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(2)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(2)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(2)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(2)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(2)

      expect(code).toBe(0)
    })

    test('removes duplicate step function arns', async () => {
      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
    })
  })

  describe('step function tags', () => {
    test('sets dd_sls_ci tag if not already set', async () => {
      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--env',
        'test',
      ])

      expect(code).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets dd_sls_ci tag if changed', async () => {
      const stepFunctionTagList = stepFunctionTagListFixture([{key: 'dd_sls_ci', value: 'v1.0.0'}])
      jest.spyOn(aws, 'listTagsForResource').mockResolvedValue({tags: stepFunctionTagList} as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--env',
        'test',
      ])

      expect(code).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets env tag if not already set', async () => {
      jest.spyOn(aws, 'listTagsForResource').mockResolvedValue({tags: [{key: 'dd_sls_ci', value: 'v2.0.0'}]} as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--env',
        'test',
      ])

      expect(code).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets service tag if not already set', async () => {
      const stepFunctionTagList = stepFunctionTagListFixture([{key: 'dd_sls_ci', value: 'v2.0.0'}])
      jest.spyOn(aws, 'listTagsForResource').mockResolvedValue({tags: stepFunctionTagList} as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--env',
        'test',
        '--service',
        'test-service',
      ])

      expect(code).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })
  })

  describe('step function logging disabled', () => {
    test('creates step function log group, subscribes it to forwarder, and adds it to step function logging config', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const stepFunction = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(stepFunction as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(1)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(1)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })
  })

  describe('step function logging enabled', () => {
    test('subscribes log group in step function logging config to forwarder', async () => {
      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(0) // already has logging properly set
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })

    test('log level is not ALL, should call enableStepFunctionLogs', async () => {
      const loggingConfiguration = {
        level: LogLevel.FATAL,
        includeExecutionData: true,
        destinations: [
          {
            cloudWatchLogsLogGroup: {
              logGroupArn:
                'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*',
            },
          },
        ],
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(describeStateMachineCommandOutput as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })

    test('log level is ALL but includeExecutionData is false. Should call enableStepFunctionLogs', async () => {
      const loggingConfiguration = {
        level: LogLevel.ALL,
        includeExecutionData: false,
        destinations: [
          {
            cloudWatchLogsLogGroup: {
              logGroupArn:
                'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*',
            },
          },
        ],
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockImplementation(() => describeStateMachineCommandOutput as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })

    test('log level is not ALL but includeExecutionData is false. Should call enableStepFunctionLogs', async () => {
      const loggingConfiguration = {
        level: LogLevel.FATAL,
        includeExecutionData: false,
        destinations: [
          {
            cloudWatchLogsLogGroup: {
              logGroupArn:
                'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*',
            },
          },
        ],
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(describeStateMachineCommandOutput as any)

      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })
  })

  describe('mergeStepFunctionAndLambdaTraces enabled', () => {
    test('mergeStepFunctionAndLambdaTraces flag is set (to true)', async () => {
      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--merge-lambda-traces',
      ])
      expect(helpers.injectContextIntoTasks).toHaveBeenCalledTimes(1)
      expect(code).toBe(0)
    })

    test('mergeStepFunctionAndLambdaTraces flag is not set (default to false)', async () => {
      const {code} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])
      expect(helpers.injectContextIntoTasks).toHaveBeenCalledTimes(0)
      expect(code).toBe(0)
    })
  })

  describe('aws error handling', () => {
    test('errors if unable to fetch step function', async () => {
      jest.spyOn(aws, 'describeStateMachine').mockImplementation(() => {
        throw new Error('mock describeStateMachine error')
      })

      const {code, context} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch(
        '[Error] mock describeStateMachine error. Unable to describe state machine arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })

    test('errors if unable to fetch step function tags', async () => {
      jest.spyOn(aws, 'listTagsForResource').mockImplementation(() => {
        throw new Error('mock listTagsForResource error')
      })

      const {code, context} = await runCLI([
        '--forwarder',
        'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch(
        '[Error] mock listTagsForResource error. Unable to fetch tags for Step Function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })
  })
})
