import {DescribeStateMachineCommandOutput, LogLevel} from '@aws-sdk/client-sfn'
import {BaseContext} from 'clipanion'

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
  injectContextForStepFunctions,
  shouldUpdateStepForStepFunctionContextInjection,
} from '../helpers'

import {describeStateMachineFixture} from './fixtures/aws-resources'

const createMockContext = (): BaseContext => {
  return {
    stdout: {
      write: (input: string) => {
        return true
      },
    },
  } as BaseContext
}

describe('stepfunctions command helpers tests', () => {
  const context = createMockContext()
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
      expect(shouldUpdateStepForTracesMerging(step, context, 'Lambda Invoke')).toBeFalsy()
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
      expect(shouldUpdateStepForTracesMerging(step, context, 'Lambda Invoke')).toBeTruthy()
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
      expect(shouldUpdateStepForTracesMerging(step, context, 'Lambda Invoke')).toBeTruthy()
    })

    test('custom payload field not using JsonPath expression', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Payload: '{"action": "service/delete_customer"}',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test('custom payload field using JsonPath expression', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          'Payload.$': '{"customer.$": "$.customer"}',
        },
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step, context, 'Lambda Invoke')).toBeFalsy()
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
      expect(shouldUpdateStepForTracesMerging(step, context, 'DynamoDB Update')).toBeFalsy()
    })

    test('legacy lambda api should not be updated', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:lambda:sa-east-1:601427271234:function:hello-function',
        End: true,
      }
      expect(shouldUpdateStepForTracesMerging(step, context, 'Legacy Lambda')).toBeFalsy()
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
        level: LogLevel.OFF,
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

  describe('shouldUpdateStepForStepFunctionContextInjection', () => {
    test('is true for an empty object', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {},
        },
        End: true,
      }
      expect(
        shouldUpdateStepForStepFunctionContextInjection(step, context, 'Step Functions StartExecution')
      ).toBeTruthy()
    })

    test('is true for undefined', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
        },
        End: true,
      }
      expect(
        shouldUpdateStepForStepFunctionContextInjection(step, context, 'Step Functions StartExecution')
      ).toBeTruthy()
    })

    test('is false when Input is an object that contains a CONTEXT key', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {'CONTEXT.$': 'blah'},
        },
        End: true,
      }
      expect(
        shouldUpdateStepForStepFunctionContextInjection(step, context, 'Step Functions StartExecution')
      ).toBeFalsy()
    })
  })

  describe('inject context for StepFunctions', () => {
    test('injects context into a step function invocation', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {},
        },
        End: true,
      }

      const changed = injectContextForStepFunctions(step, context, 'Step Functions StartExecution')
      expect(changed).toBeTruthy()
      expect(step.Parameters?.Input).toEqual({'CONTEXT.$': 'States.JsonMerge($$, $, false)'})
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
