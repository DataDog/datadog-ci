import {SubscriptionFilter} from '@aws-sdk/client-cloudwatch-logs/dist-types/models/models_0'
import {DescribeStateMachineCommandOutput, LogLevel} from '@aws-sdk/client-sfn'
import {Tag} from '@aws-sdk/client-sfn/dist-types/ts3.4/models/models_0'

export const describeStateMachineFixture = (
  props: Partial<DescribeStateMachineCommandOutput> = {}
): DescribeStateMachineCommandOutput => {
  const defaults: DescribeStateMachineCommandOutput = {
    $metadata: {},
    stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
    name: 'ExampleStepFunction',
    definition: '',
    loggingConfiguration: {
      level: LogLevel.ALL,
      includeExecutionData: true,
      destinations: [
        {
          cloudWatchLogsLogGroup: {
            logGroupArn:
              'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*',
          },
        },
      ],
    },
    roleArn: `arn:aws:iam::000000000000:role/ExampleStepFunctionRole`,
    type: 'STANDARD',
    creationDate: new Date('2023-03-08T00:00:00Z'),
  }

  return {...defaults, ...props}
}

export const stepFunctionTagListFixture = (props: Tag[] = []): Tag[] => {
  const defaults: Tag[] = [{key: 'env', value: 'test'}]
  defaults.push(...props)

  return defaults
}

export const subscriptionFilterFixture = (props: Partial<SubscriptionFilter> = {}): SubscriptionFilter => {
  const defaults: SubscriptionFilter = {
    destinationArn: 'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
    filterName: 'ExampleStepFunction-DdCiLogGroupSubscription',
    filterPattern: '',
    logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
  }

  return {...defaults, ...props}
}
