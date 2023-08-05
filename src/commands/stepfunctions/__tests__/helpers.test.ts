import {DescribeStateMachineCommandOutput} from '@aws-sdk/client-sfn'

import {
  buildArn,
  buildLogGroupName,
  buildSubscriptionFilterName,
  isValidArn,
  getStepFunctionLogGroupArn,
  parseArn,
  buildLogAccessPolicyName,
  shouldUpdateStepForTracesMerging,
  StepType,
} from '../helpers'

import {describeStateMachineFixture} from './fixtures/aws-resources'

describe('stepfunctions command helpers tests', () => {
  describe('shouldUpdateStepForTracesMerging test', () => {
    test('already has JsonMerge added to payload field', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          'Payload.$': 'States.JsonMerge($$, $, false)',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step)).toBeFalsy()
    })

    test('no payload field', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step)).toBeTruthy()
    })

    test('default payload field of $', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          'Payload.$': '$',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step)).toBeTruthy()
    })

    test('none-lambda step should not be updated', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: 'step-functions-tracing-self-monitoring-table-staging',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step)).toBeFalsy()
    })

    test('legacy lambda api should not be updated', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:lambda:sa-east-1:601427271234:function:hello-function',
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step)).toBeFalsy()
    })
  })

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
      const stepFunction = describeStateMachineFixture()
      const env = 'test'
      const logGroupName = buildLogGroupName(stepFunction.name!, env)

      expect(logGroupName).toBe('/aws/vendedlogs/states/ExampleStepFunction-Logs-test')
    })

    test('builds log group name from step function name without env', () => {
      const stepFunction = describeStateMachineFixture()
      let env
      const logGroupName = buildLogGroupName(stepFunction.name!, env)
      expect(logGroupName).toBe('/aws/vendedlogs/states/ExampleStepFunction-Logs')
    })
  })

  describe('buildSubscriptionFilterName', () => {
    test('builds subscription filter name from step function name', () => {
      const stepFunction = describeStateMachineFixture()
      const subscriptionFilterName = buildSubscriptionFilterName(stepFunction.name!)

      expect(subscriptionFilterName).toBe('ExampleStepFunction-DdCiLogGroupSubscription')
    })
  })

  describe('isValidArn', () => {
    test('returns true for valid step function arn', () => {
      const stepFunction = describeStateMachineFixture()

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
      const stepFunction = describeStateMachineFixture()
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
      const stepFunction = describeStateMachineFixture({loggingConfiguration})
      const logGroupArn = getStepFunctionLogGroupArn(stepFunction)

      expect(logGroupArn).toBe(undefined)
    })
  })

  describe('parseArn', () => {
    test('parses step function arn', () => {
      const stepFunction = describeStateMachineFixture()
      const arnObject = parseArn(stepFunction.stateMachineArn!)

      expect(arnObject.partition).toBe('aws')
      expect(arnObject.region).toBe('us-east-1')
      expect(arnObject.accountId).toBe('000000000000')
      expect(arnObject.resourceName).toBe('ExampleStepFunction')
    })
  })

  test('buildLogAccessPolicyName test', () => {
    const fakeStateMachineName = 'fakeStateMachineName'
    const describeStateMachineCommandOutput: DescribeStateMachineCommandOutput = {
      $metadata: {},
      creationDate: undefined,
      definition: undefined,
      roleArn: undefined,
      type: undefined,
      stateMachineArn: 'fakeStepFunctionArn',
      name: fakeStateMachineName,
    }
    const actual = buildLogAccessPolicyName(describeStateMachineCommandOutput)
    expect(actual).toEqual(`LogsDeliveryAccessPolicy-${fakeStateMachineName}`)
  })
})
