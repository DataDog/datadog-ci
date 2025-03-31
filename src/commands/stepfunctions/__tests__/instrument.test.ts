import {LogLevel} from '@aws-sdk/client-sfn'
import {Cli} from 'clipanion/lib/advanced'

import {InstrumentStepFunctionsCommand} from '../instrument'

import {describeStateMachineFixture, stepFunctionTagListFixture} from './fixtures/aws-resources'
import {contextFixture, ContextFixture} from './fixtures/cli'

jest.mock('../../../../package.json', () => ({version: '2.0.0'}))

describe('stepfunctions instrument test', () => {
  let aws: any
  let cli: Cli
  let context: ContextFixture
  let helpers: any

  beforeAll(() => {
    aws = require('../awsCommands')
    helpers = require('../helpers')
    helpers.applyChanges = jest.fn().mockImplementation(() => false)
    helpers.injectContextIntoTasks = jest.fn().mockImplementation()
    cli = new Cli()
    cli.register(InstrumentStepFunctionsCommand)
  })
  beforeEach(() => {
    context = contextFixture()

    const describeStateMachineCommandOutput = describeStateMachineFixture()
    aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

    const stepFunctionTagList = [{key: 'env', value: 'test'}]
    aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: stepFunctionTagList}))

    aws.tagResource = jest.fn().mockImplementation(() => ({}))
    aws.createLogGroup = jest.fn().mockImplementation(() => ({}))
    aws.putSubscriptionFilter = jest.fn().mockImplementation(() => ({}))
    aws.createLogsAccessPolicy = jest.fn().mockImplementation(() => ({}))
    aws.attachPolicyToStateMachineIamRole = jest.fn().mockImplementation(() => ({}))
    aws.enableStepFunctionLogs = jest.fn().mockImplementation(() => ({}))
    aws.putSubscriptionFilter = jest.fn().mockImplementation(() => ({}))
  })

  describe('parameter validation', () => {
    test('errors if forwarder arn is not set', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] `--forwarder` is required')
    })

    test('errors if forwarder arn is invalid', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument', '--forwarder', 'bla:'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] Invalid arn format for `--forwarder` bla:\n')
    })

    test('errors if no step function arn', async () => {
      const exitCode = await cli.run(
        ['stepfunctions', 'instrument', '--forwarder', 'arn:aws:lambda:sa-east-1:601427279990:function:hello'],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] Must specify at least one `--step-function`')
    })

    test('errors if any step function arn is invalid', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:sa-east-1:601427279990:function:hello',
          '--step-function',
          'bla',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] Invalid arn format for `--step-function` bla')
    })

    test('errors if no env tag on step function and env parameter not set', async () => {
      aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: []}))

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] --env is required when a Step Function has no env tag')
    })
  })

  describe('stepfunctions command overall test', () => {
    test('all aws commands are called when log level is OFF', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--env',
          'test',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(1)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(1)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)

      expect(exitCode).toBe(0)
    })

    test('all aws commands are called the same times when as log-level-off state machines', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const describeStateMachineCommandOutput = describeStateMachineFixture({loggingConfiguration})
      aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction222',
          '--env',
          'test',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(2)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(2)
      expect(aws.tagResource).toHaveBeenCalledTimes(2)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(2)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(2)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(2)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(2)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(2)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(2)

      expect(exitCode).toBe(0)
    })

    test('removes duplicate step function arns', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
    })
  })

  describe('step function tags', () => {
    test('sets dd_sls_ci tag if not already set', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--env',
          'test',
        ],
        context
      )

      expect(exitCode).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets dd_sls_ci tag if changed', async () => {
      const stepFunctionTagList = stepFunctionTagListFixture([{key: 'dd_sls_ci', value: 'v1.0.0'}])
      aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: stepFunctionTagList}))

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--env',
          'test',
        ],
        context
      )

      expect(exitCode).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets env tag if not already set', async () => {
      aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: [{key: 'dd_sls_ci', value: 'v2.0.0'}]}))

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--env',
          'test',
        ],
        context
      )

      expect(exitCode).toBe(0)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
    })

    test('sets service tag if not already set', async () => {
      const stepFunctionTagList = stepFunctionTagListFixture([{key: 'dd_sls_ci', value: 'v2.0.0'}])
      aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: stepFunctionTagList}))

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--env',
          'test',
          '--service',
          'test-service',
        ],
        context
      )

      expect(exitCode).toBe(0)
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
      aws.describeStateMachine = jest.fn().mockImplementation(() => stepFunction)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(1)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(1)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
    })
  })

  describe('step function logging enabled', () => {
    test('subscribes log group in step function logging config to forwarder', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(0) // already has logging properly set
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
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
      aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
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
      aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
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
      aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.listTagsForResource).toHaveBeenCalledTimes(1)
      expect(aws.tagResource).toHaveBeenCalledTimes(1)
      expect(aws.createLogGroup).toHaveBeenCalledTimes(0)
      expect(aws.createLogsAccessPolicy).toHaveBeenCalledTimes(0)
      expect(aws.attachPolicyToStateMachineIamRole).toHaveBeenCalledTimes(0)
      expect(aws.enableStepFunctionLogs).toHaveBeenCalledTimes(1)
      expect(aws.putSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
    })
  })

  describe('mergeStepFunctionAndLambdaTraces enabled', () => {
    test('mergeStepFunctionAndLambdaTraces flag is set (to true)', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
          '--merge-lambda-traces',
        ],
        context
      )
      expect(helpers.injectContextIntoTasks).toHaveBeenCalledTimes(1)
      expect(exitCode).toBe(0)
    })

    test('mergeStepFunctionAndLambdaTraces flag is not set (default to false)', async () => {
      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )
      expect(helpers.injectContextIntoTasks).toHaveBeenCalledTimes(0)
      expect(exitCode).toBe(0)
    })
  })

  describe('aws error handling', () => {
    test('errors if unable to fetch step function', async () => {
      aws.describeStateMachine = jest.fn().mockImplementation(() => {
        throw new Error('mock describeStateMachine error')
      })

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch(
        '[Error] mock describeStateMachine error. Unable to describe state machine arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })

    test('errors if unable to fetch step function tags', async () => {
      aws.listTagsForResource = jest.fn().mockImplementation(() => {
        throw new Error('mock listTagsForResource error')
      })

      const exitCode = await cli.run(
        [
          'stepfunctions',
          'instrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch(
        '[Error] mock listTagsForResource error. Unable to fetch tags for Step Function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })
  })
})
