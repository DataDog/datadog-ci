import {LogLevel} from '@aws-sdk/client-sfn'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import * as aws from '../awsCommands'
import {UninstrumentStepFunctionsCommand} from '../uninstrument'

import {describeStateMachineFixture, subscriptionFilterFixture} from './fixtures/aws-resources'

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: '2.0.0'}))

describe('stepfunctions uninstrument', () => {
  const runCLI = makeRunCLI(UninstrumentStepFunctionsCommand, ['stepfunctions', 'uninstrument'])

  beforeEach(() => {
    const describeStateMachineCommandOutput = describeStateMachineFixture()
    jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(describeStateMachineCommandOutput)

    const subscriptionFilter = subscriptionFilterFixture()
    jest.spyOn(aws, 'describeSubscriptionFilters').mockResolvedValue({subscriptionFilters: [subscriptionFilter]} as any)
    jest.spyOn(aws, 'deleteSubscriptionFilter').mockResolvedValue({} as any)
    jest.spyOn(aws, 'untagResource').mockResolvedValue({} as any)
  })

  describe('parameter validation', () => {
    test('errors if --step-function is not given', async () => {
      const {code, context} = await runCLI([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] must specify at least one `--step-function`\n')
    })

    test('removes duplicate step function arns', async () => {
      const {code} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])
      expect(code).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
    })

    test('errors if no step function arn', async () => {
      const {code, context} = await runCLI([])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] must specify at least one `--step-function`')
    })

    test('errors if any step function arn is invalid', async () => {
      const {code, context} = await runCLI(['--step-function', 'arn:'])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch('[Error] invalid arn format for `--step-function`')
    })
  })

  describe('step function logging disabled', () => {
    test('creates step function log group, subscribes it to forwarder, and adds it to step function logging config', async () => {
      const loggingConfiguration = {
        level: LogLevel.OFF,
        includeExecutionData: false,
      }
      const stepFunction = describeStateMachineFixture({loggingConfiguration})
      jest.spyOn(aws, 'describeStateMachine').mockResolvedValue(stepFunction)

      const {code, context} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch(
        '[Error] Unable to get Log Group arn from Step Function logging configuration'
      )
    })
  })

  describe('aws error handling', () => {
    test('errors if unable to fetch step function', async () => {
      jest.spyOn(aws, 'describeStateMachine').mockImplementation(() => {
        throw new Error('mock describeStateMachine error')
      })

      const {code, context} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch(
        '[Error] mock describeStateMachine error. Unable to fetch Step Function arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction'
      )
    })

    test('errors if unable to fetch step function subscription filters', async () => {
      jest.spyOn(aws, 'describeSubscriptionFilters').mockImplementation(() => {
        throw new Error('mock describeSubscriptionFilters error')
      })

      const {code, context} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(1)
      expect(context.stdout.toString()).toMatch(
        '[Error] mock describeSubscriptionFilters error. Unable to fetch Subscription Filter to delete for Log Group /aws/vendedlogs/states/ExampleStepFunction-Logs-test'
      )
    })

    test('all aws commands are called once for one ci-instrumented step function', async () => {
      const {code} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.describeSubscriptionFilters).toHaveBeenCalledTimes(1)
      expect(aws.deleteSubscriptionFilter).toHaveBeenCalledTimes(1)
      expect(aws.untagResource).toHaveBeenCalledTimes(1)
    })

    test('all aws commands are called twice for two ci-instrumented step functions', async () => {
      const {code} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction2222',
      ])

      expect(code).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(2)
      expect(aws.describeSubscriptionFilters).toHaveBeenCalledTimes(2)
      expect(aws.deleteSubscriptionFilter).toHaveBeenCalledTimes(2)
      expect(aws.untagResource).toHaveBeenCalledTimes(2)
    })

    test('no subscription filters are created by ci, so deleteSubscriptionFilter is not called', async () => {
      const subscriptionFilter = subscriptionFilterFixture({
        filterName: 'test-filter-name-that-does-not-have-DD_CI_IDENTIFYING_STRING-string',
      })
      jest
        .spyOn(aws, 'describeSubscriptionFilters')
        .mockResolvedValue({subscriptionFilters: [subscriptionFilter]} as any)

      const {code} = await runCLI([
        '--step-function',
        'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
      ])

      expect(code).toBe(0)
      expect(aws.describeStateMachine).toHaveBeenCalledTimes(1)
      expect(aws.describeSubscriptionFilters).toHaveBeenCalledTimes(1)
      expect(aws.deleteSubscriptionFilter).toHaveBeenCalledTimes(0)
      expect(aws.untagResource).toHaveBeenCalledTimes(1) // Will always be called
    })
  })
})
