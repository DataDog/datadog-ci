import {Cli} from 'clipanion/lib/advanced'

import {InstrumentStepFunctionsCommand} from '../instrument'

import {describeStateMachineFixture, stepFunctionTagListFixture} from './fixtures/aws-resources'
import {contextFixture, testContext} from './fixtures/cli'

jest.mock('../../../../package.json', () => ({version: '2.0.0'}))

describe('stepfunctions instrument test', () => {
  let cli: Cli
  let aws: any
  let helpers: any

  beforeAll(() => {
    helpers = require('../helpers')
    helpers.applyChanges = jest.fn().mockImplementation(() => false)

    cli = new Cli()
    cli.register(InstrumentStepFunctionsCommand)
  })

  let context: testContext
  beforeEach(() => {
    aws = require('../awsCommands')
    context = contextFixture()

    // different function responses may be needed depending on the test
    const describeStateMachineCommandOutput = describeStateMachineFixture()
    aws.describeStateMachine = jest.fn().mockImplementation(() => describeStateMachineCommandOutput)

    const stepFunctionTagList = [{key: 'env', value: 'test'}]
    aws.listTagsForResource = jest.fn().mockImplementation(() => ({tags: stepFunctionTagList}))

    aws.tagResource = jest.fn().mockImplementation(() => ({}))
    aws.putSubscriptionFilter = jest.fn().mockImplementation(() => ({}))
    aws.createLogsAccessPolicy = jest.fn().mockImplementation(() => ({}))
    aws.attachPolicyToStateMachineIamRole = jest.fn().mockImplementation(() => ({}))
    aws.enableStepFunctionLogs = jest.fn().mockImplementation(() => ({}))
    aws.putSubscriptionFilter = jest.fn().mockImplementation(() => ({}))
  })

  describe('paramater validation', () => {
    test('errors if forwarder arn is not set', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] --forwarder is required')
    })

    test('errors if forwarder arn is invalid', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument', '--forwarder', 'arn:'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] invalid arn format for --forwarder arn:')
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

    test('errors if no step function arn', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] must specify at least one --step-function')
    })

    test('errors if any step function arn is invalid', async () => {
      const exitCode = await cli.run(['stepfunctions', 'instrument', '--step-function', 'arn:'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] invalid arn format for --step-function')
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
      expect(context.toString()).toMatchSnapshot()
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
      expect(context.toString()).toMatchSnapshot()
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
      expect(context.toString()).toMatchSnapshot()
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
      expect(context.toString()).toMatchSnapshot()
    })
  })

  describe('step function logging disabled', () => {
    test('creates step function log group, subscribes it to forwarder, and adds it to step function logging config', async () => {
      const loggingConfiguration = {
        level: 'OFF',
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

      expect(exitCode).toBe(0)
      expect(context.toString()).toMatchSnapshot()
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

      expect(exitCode).toBe(0)
      expect(context.toString()).toMatchSnapshot()
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
