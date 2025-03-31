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
  injectContextForLambdaFunctions,
  StepType,
  injectContextForStepFunctions,
  PayloadObject,
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
  describe('injectContextForLambdaFunctions test', () => {
    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            'Payload.$': 'States.JsonMerge($$, $, false)',
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:us-east-1:123456789012:function:HelloFunction',
          Parameters: {
            'Payload.$': 'States.JsonMerge($$, $, false)',
          },
          End: true,
        },
      ],
    ])('Case 4.2: already has JsonMerge added to payload field using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            'Payload.$': `$$['Execution', 'State', 'StateMachine']`,
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            'Payload.$': `$$['Execution', 'State', 'StateMachine']`,
          },
          End: true,
        },
      ],
    ])('Case 4.2: context injection already set up using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test('Case 1: no Payload or Payload.$', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::lambda:invoke',
        Parameters: {
          FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
        },
        End: true,
      }
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeTruthy()
      expect(step.Parameters?.['Payload.$']).toEqual(`$$['Execution', 'State', 'StateMachine']`)
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: 'Just a string!',
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            Payload: 'Just a string!',
          },
          End: true,
        },
      ],
    ])('Case 3: Payload is not a JSON object using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: {
              'Execution.$': '$$.Execution',
              'State.$': '$$.State',
              'StateMachine.$': '$$.StateMachine',
            },
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            Payload: {
              'Execution.$': '$$.Execution',
              'State.$': '$$.State',
              'StateMachine.$': '$$.StateMachine',
            },
          },
          End: true,
        },
      ],
    ])('Case 2.1: already injected Execution, State and StateMachine into Payload using %d definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: {
              State: {Name: 'Lambda Invoke'},
            },
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            Payload: {
              State: {Name: 'Lambda Invoke'},
            },
          },
          End: true,
        },
      ],
    ])('Case 2.2: custom State field in Payload using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: {},
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            Payload: {},
          },
          End: true,
        },
      ],
      [
        'WaitForTaskToken',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke.waitForTaskToken',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: {},
          },
          End: true,
        },
      ],
    ])('Case 2.3: no Execution, State, or StateMachine field in Payload using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeTruthy()
      const payload = step.Parameters?.['Payload'] as PayloadObject
      expect(payload['Execution.$']).toEqual('$$.Execution')
      expect(payload['State.$']).toEqual('$$.State')
      expect(payload['StateMachine.$']).toEqual('$$.StateMachine')
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            'Payload.$': '$',
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            'Payload.$': '$',
          },
          End: true,
        },
      ],
    ])('Case 4.1: default payload field of $ using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeTruthy()
      expect(step.Parameters?.['Payload.$']).toEqual('States.JsonMerge($$, $, false)')
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            Payload: '{"action": "service/delete_customer"}',
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            Payload: '{"action": "service/delete_customer"}',
          },
          End: true,
        },
      ],
    ])('Case 4.3: custom payload field not using JsonPath expression using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test.each([
      [
        'Standard',
        {
          Type: 'Task',
          Resource: 'arn:aws:states:::lambda:invoke',
          Parameters: {
            FunctionName: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
            'Payload.$': '{"customer.$": "$.customer"}',
          },
          End: true,
        },
      ],
      [
        'Legacy',
        {
          Type: 'Task',
          Resource: 'arn:aws:lambda:sa-east-1:425362991234:function:unit-test-lambda-function',
          Parameters: {
            'Payload.$': '{"customer.$": "$.customer"}',
          },
          End: true,
        },
      ],
    ])('Case 4.3: custom payload field using JsonPath expression using %s definition', (_, step) => {
      expect(injectContextForLambdaFunctions(step, context, 'Lambda Invoke')).toBeFalsy()
    })

    test('non-lambda step should not be updated', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: 'step-functions-tracing-self-monitoring-table-staging',
        },
        End: true,
      }
      expect(injectContextForLambdaFunctions(step, context, 'DynamoDB Update')).toBeFalsy()
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
      expect(step.Parameters?.Input).toEqual({'CONTEXT.$': `$$['Execution', 'State', 'StateMachine']`})
    })

    test('Case 1: is true when "CONTEXT.$" and "CONTEXT" fields are not set', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {},
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeTruthy()
      expect(step.Parameters?.Input).toEqual({'CONTEXT.$': `$$['Execution', 'State', 'StateMachine']`})
    })

    test('is true when Input field is not set', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeTruthy()
      expect(step.Parameters?.Input).toEqual({'CONTEXT.$': `$$['Execution', 'State', 'StateMachine']`})
    })

    test('Case 3.2: is false when Input contains a custom "CONTEXT.$" field', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {'CONTEXT.$': 'blah'},
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeFalsy()
    })

    test('Case 2: is false when Input contains "CONTEXT" field', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {CONTEXT: 'blah'},
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeFalsy()
    })

    test('Case 3.1: is false when context injection is already set up using States.JsonMerge($$, $, false)', () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {
            'CONTEXT.$': 'States.JsonMerge($$, $, false)',
          },
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeFalsy()
    })

    test(`Case 3.1: is false when context injection is already set up using $$['Execution', 'State', 'StateMachine']`, () => {
      const step: StepType = {
        Type: 'Task',
        Resource: 'arn:aws:states:::states:startExecution.sync:2',
        Parameters: {
          StateMachineArn: 'arn:aws:states:us-east-1:425362996713:stateMachine:agocs_inner_state_machine',
          Input: {
            'CONTEXT.$': `$$['Execution', 'State', 'StateMachine']`,
          },
        },
        End: true,
      }
      expect(injectContextForStepFunctions(step, context, 'Step Functions StartExecution')).toBeFalsy()
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
