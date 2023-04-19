import {
  buildArn,
  buildLogGroupName,
  buildSubscriptionFilterName,
  isValidArn,
  getStepFunctionLogGroupArn,
  parseArn,
} from '../helpers'

import {stepFunctionFixture} from './fixtures/aws-resources'

describe('helpers', () => {
  describe('buildArn', () => {
    test('builds log group arn', () => {
      const partition = 'aws'
      const service = 'logs'
      const region = 'us-east-1'
      const accountId = '000000000000'
      const resourceType = 'log-group'
      const resourceId = '/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'
      const logGroupArn = buildArn(partition, service, region, accountId, resourceType, resourceId)

      expect(logGroupArn).toBe(
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'
      )
    })
  })

  describe('buildLogGroupName', () => {
    test('builds log group name from step function name with env', () => {
      const stepFunction = stepFunctionFixture()
      const env = 'test'
      const logGroupName = buildLogGroupName(stepFunction.name!, env)

      expect(logGroupName).toBe('/aws/vendedlogs/states/ExampleStepFunction-Logs-test')
    })

    test('builds log group name from step function name without env', () => {
      const stepFunction = stepFunctionFixture()
      let env
      const logGroupName = buildLogGroupName(stepFunction.name!, env)
      expect(logGroupName).toBe('/aws/vendedlogs/states/ExampleStepFunction-Logs')
    })
  })

  describe('buildSubscriptionFilterName', () => {
    test('builds subscription filter name from step function name', () => {
      const stepFunction = stepFunctionFixture()
      const subscriptionFilterName = buildSubscriptionFilterName(stepFunction.name!)

      expect(subscriptionFilterName).toBe('ExampleStepFunction-DdCiLogGroupSubscription')
    })
  })

  describe('isValidArn', () => {
    test('returns true for valid step function arn', () => {
      const stepFunction = stepFunctionFixture()

      expect(isValidArn(stepFunction.stateMachineArn!)).toBe(true)
    })

    test('returns true for valid lambda function arn', () => {
      const lambdaFunctionArn = 'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder'

      expect(isValidArn(lambdaFunctionArn)).toBe(true)
    })

    test('returns false for invalid arn', () => {
      const arn = ''

      expect(isValidArn(arn)).toBe(false)
    })
  })

  describe('getStepFunctionLogGroupArn', () => {
    test('returns step function log group arn when it is set', () => {
      const stepFunction = stepFunctionFixture()
      const logGroupArn = getStepFunctionLogGroupArn(stepFunction)

      expect(logGroupArn).toBe(
        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'
      )
    })

    test('returns undefined when step function logging is off', () => {
      const loggingConfiguration = {
        level: 'OFF',
        includeExecutionData: false,
      }
      const stepFunction = stepFunctionFixture({loggingConfiguration})
      const logGroupArn = getStepFunctionLogGroupArn(stepFunction)

      expect(logGroupArn).toBe(undefined)
    })
  })

  describe('parseArn', () => {
    test('parses step function arn', () => {
      const stepFunction = stepFunctionFixture()
      const arnObject = parseArn(stepFunction.stateMachineArn!)

      expect(arnObject.partition).toBe('aws')
      expect(arnObject.region).toBe('us-east-1')
      expect(arnObject.accountId).toBe('000000000000')
      expect(arnObject.resourceName).toBe('ExampleStepFunction')
    })
  })
})
