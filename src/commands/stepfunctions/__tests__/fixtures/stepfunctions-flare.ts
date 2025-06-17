import {SubscriptionFilter, OutputLogEvent} from '@aws-sdk/client-cloudwatch-logs'
import {DescribeStateMachineCommandOutput, ExecutionListItem, HistoryEvent, Tag} from '@aws-sdk/client-sfn'

export const stateMachineConfigFixture = (
  props: Partial<DescribeStateMachineCommandOutput> = {}
): DescribeStateMachineCommandOutput => {
  const defaults: DescribeStateMachineCommandOutput = {
    $metadata: {},
    stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow',
    name: 'MyWorkflow',
    status: 'ACTIVE',
    definition: JSON.stringify({
      StartAt: 'HelloWorld',
      States: {
        HelloWorld: {
          Type: 'Pass',
          Result: 'Hello World!',
          End: true,
        },
      },
    }),
    roleArn: 'arn:aws:iam::123456789012:role/MyRole',
    type: 'STANDARD',
    creationDate: new Date('2024-01-01'),
    loggingConfiguration: {
      level: 'ALL',
      includeExecutionData: true,
      destinations: [
        {
          cloudWatchLogsLogGroup: {
            logGroupArn: 'arn:aws:logs:us-east-1:123456789012:log-group:/aws/vendedlogs/states/MyWorkflow-Logs',
          },
        },
      ],
    },
  }

  return {...defaults, ...props}
}

export const sensitiveStateMachineConfigFixture = (): DescribeStateMachineCommandOutput => {
  return stateMachineConfigFixture({
    definition: JSON.stringify({
      StartAt: 'ProcessPayment',
      States: {
        ProcessPayment: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:us-east-1:123456789012:function:ProcessPayment',
          Parameters: {
            'ApiKey.$': '$.credentials.apiKey',
            SecretToken: 'secret-12345-token',
            DatabasePassword: 'super-secret-password',
          },
          End: true,
        },
      },
    }),
    description: 'Payment processing workflow with sensitive data',
  })
}

export const executionsFixture = (): ExecutionListItem[] => {
  return [
    {
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1',
      stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow',
      name: 'execution1',
      status: 'SUCCEEDED',
      startDate: new Date('2024-01-01T10:00:00Z'),
      stopDate: new Date('2024-01-01T10:01:00Z'),
    },
    {
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution2',
      stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow',
      name: 'execution2',
      status: 'FAILED',
      startDate: new Date('2024-01-01T09:00:00Z'),
      stopDate: new Date('2024-01-01T09:01:00Z'),
    },
  ]
}

export const sensitiveExecutionFixture = (): any => {
  return {
    executionArn: 'arn:aws:states:us-east-1:123456789012:execution:MyWorkflow:execution1',
    stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow',
    name: 'execution1',
    status: 'SUCCEEDED',
    startDate: new Date('2024-01-01T10:00:00Z'),
    stopDate: new Date('2024-01-01T10:01:00Z'),
    input: '{"creditCard": "4111-1111-1111-1111", "cvv": "123", "amount": 100}',
    output: '{"transactionId": "secret-transaction-id", "authToken": "Bearer secret-token"}',
  }
}

export const executionHistoryFixture = (): HistoryEvent[] => {
  return [
    {
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'ExecutionStarted',
      id: 1,
      previousEventId: 0,
      executionStartedEventDetails: {
        input: '{"orderId": "12345"}',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
      },
    },
    {
      timestamp: new Date('2024-01-01T10:00:01Z'),
      type: 'TaskStateEntered',
      id: 2,
      previousEventId: 1,
      stateEnteredEventDetails: {
        name: 'ProcessPayment',
        input: '{"orderId": "12345", "amount": 100}',
      },
    },
    {
      timestamp: new Date('2024-01-01T10:00:59Z'),
      type: 'TaskStateExited',
      id: 3,
      previousEventId: 2,
      stateExitedEventDetails: {
        name: 'ProcessPayment',
        output: '{"success": true, "transactionId": "tx-12345"}',
      },
    },
    {
      timestamp: new Date('2024-01-01T10:01:00Z'),
      type: 'ExecutionSucceeded',
      id: 4,
      previousEventId: 3,
      executionSucceededEventDetails: {
        output: '{"result": "completed"}',
      },
    },
  ]
}

export const stepFunctionTagsFixture = (): Tag[] => {
  return [
    {key: 'Environment', value: 'test'},
    {key: 'Service', value: 'payment-processor'},
    {key: 'Team', value: 'platform'},
  ]
}

export const logSubscriptionFiltersFixture = (): SubscriptionFilter[] => {
  return [
    {
      filterName: 'datadog-forwarder',
      destinationArn: 'arn:aws:lambda:us-east-1:123456789012:function:DatadogForwarder',
      filterPattern: '',
      logGroupName: '/aws/vendedlogs/states/MyWorkflow-Logs',
    },
  ]
}

export const cloudWatchLogsFixture = (): OutputLogEvent[] => {
  return [
    {
      timestamp: 1704106800000,
      message: 'Execution started',
      ingestionTime: 1704106801000,
    },
    {
      timestamp: 1704106801000,
      message: 'Processing payment for order 12345',
      ingestionTime: 1704106802000,
    },
    {
      timestamp: 1704106859000,
      message: 'Payment processed successfully',
      ingestionTime: 1704106860000,
    },
    {
      timestamp: 1704106860000,
      message: 'Execution completed',
      ingestionTime: 1704106861000,
    },
  ]
}

export const MOCK_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow'
export const MOCK_REGION = 'us-east-1'
export const MOCK_CASE_ID = 'case-123456'
export const MOCK_EMAIL = 'test@example.com'
export const MOCK_API_KEY = 'test-api-key-1234'

export const MOCK_AWS_CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: undefined,
}

export const MOCK_FRAMEWORK = 'Serverless Framework'

export const MOCK_OUTPUT_DIR = '.datadog-ci/flare/stepfunctions-MyWorkflow-1704106800000'

export const MOCK_INSIGHTS_CONTENT = `# Step Functions Flare Insights

Generated: 2024-01-01T10:00:00.000Z

## State Machine Configuration
- Name: MyWorkflow
- ARN: arn:aws:states:us-east-1:123456789012:stateMachine:MyWorkflow
- Type: STANDARD
- Status: ACTIVE

## Framework
Serverless Framework

## Environment
- Region: us-east-1
- CLI Version: 1.0.0
`
