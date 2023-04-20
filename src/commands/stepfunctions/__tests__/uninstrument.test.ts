import {Cli} from 'clipanion/lib/advanced'

import {UninstrumentStepFunctionsCommand} from '../uninstrument'

import {describeStateMachineFixture, subscriptionFilterFixture} from './fixtures/aws-resources'
import {contextFixture, testContext} from './fixtures/cli'

jest.mock('../../../../package.json', () => ({version: '2.0.0'}))

describe('step-functions uninstrument', () => {
  let cli: Cli
  let aws: any
  let changes: any

  beforeAll(() => {
    changes = require('../changes')
    changes.applyChanges = jest.fn().mockImplementation(() => {
      return false
    })

    cli = new Cli()
    cli.register(UninstrumentStepFunctionsCommand)
  })

  let context: testContext
  beforeEach(() => {
    aws = require('../aws')
    context = contextFixture()

    // different function responses may be needed depending on the test
    const stepFunction = describeStateMachineFixture()
    aws.describeStateMachine = jest.fn().mockImplementation(() => stepFunction)

    const subscriptionFilter = subscriptionFilterFixture()
    aws.describeSubscriptionFilters = jest.fn().mockImplementation(() => ({subscriptionFilters: [subscriptionFilter]}))
  })

  describe('paramater validation', () => {
    test('errors if forwarder arn is not set', async () => {
      const exitCode = await cli.run(['step-functions', 'uninstrument'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] --forwarder is required')
    })

    test('errors if forwarder arn is invalid', async () => {
      const exitCode = await cli.run(['step-functions', 'uninstrument', '--forwarder', 'arn:'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] invalid arn format for --forwarder arn:')
    })

    test('removes duplicate step function arns', async () => {
      const exitCode = await cli.run(
        [
          'step-functions',
          'uninstrument',
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
      const exitCode = await cli.run(['step-functions', 'uninstrument'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] must specify at least one --step-function')
    })

    test('errors if any step function arn is invalid', async () => {
      const exitCode = await cli.run(['step-functions', 'uninstrument', '--step-function', 'arn:'], context)

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] invalid arn format for --step-function')
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
          'step-functions',
          'uninstrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch('[Error] Unable to get Log Group arn from Step Function logging configuration')
    })
  })

  describe('step function logging enabled', () => {
    test('unsubscribes log group in step function logging config from forwarder and removes dd_sls_ci tag', async () => {
      const exitCode = await cli.run(
        [
          'step-functions',
          'uninstrument',
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
          'step-functions',
          'uninstrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch(
        '[Error] mock describeStateMachine error. Unable to fetch Step Function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })

    test('errors if unable to fetch step function subscription filters', async () => {
      aws.describeSubscriptionFilters = jest.fn().mockImplementation(() => {
        throw new Error('mock describeSubscriptionFilters error')
      })

      const exitCode = await cli.run(
        [
          'step-functions',
          'uninstrument',
          '--forwarder',
          'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
          '--step-function',
          'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        ],
        context
      )

      expect(exitCode).toBe(1)
      expect(context.toString()).toMatch(
        '[Error] mock describeSubscriptionFilters error. Unable to fetch Subscription Filter to delete for Log Group /aws/vendedlogs/states/ExampleStepFunction-Logs-test'
      )
    })
  })
})
