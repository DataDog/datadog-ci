import {DescribeStateMachineCommandOutput} from '@aws-sdk/client-sfn'
import {CloudWatchLogs, StepFunctions} from 'aws-sdk'

export const cloudWatchLogsClientFixture = (
  props: Partial<CloudWatchLogs.ClientConfiguration> = {}
): CloudWatchLogs => {
  const defaults: CloudWatchLogs.ClientConfiguration = {
    region: 'us-east-1',
  }

  return new CloudWatchLogs({...defaults, ...props})
}

export const stepFunctionsClientFixture = (props: Partial<StepFunctions.ClientConfiguration> = {}): StepFunctions => {
  const defaults: StepFunctions.ClientConfiguration = {
    region: 'us-east-1',
  }

  return new StepFunctions({...defaults, ...props})
}

export const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

export const logGroupFixture = (props: Partial<CloudWatchLogs.LogGroup> = {}): CloudWatchLogs.LogGroup => {
  const defaults: CloudWatchLogs.LogGroup = {
    logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
  }

  return {...defaults, ...props}
}

export const describeStateMachineFixture = (
  props: Partial<DescribeStateMachineCommandOutput> = {}
): DescribeStateMachineCommandOutput => {
  const defaults: DescribeStateMachineCommandOutput = {
    $metadata: {},
    stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
    name: 'ExampleStepFunction',
    definition: '',
    loggingConfiguration: {
      level: 'ALL',
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

export const stepFunctionTagListFixture = (props: Partial<StepFunctions.Tag>[] = []): StepFunctions.TagList => {
  const defaults: StepFunctions.TagList = [{key: 'env', value: 'test'}]

  return defaults.concat(props)
}

export const subscriptionFilterFixture = (
  props: Partial<CloudWatchLogs.SubscriptionFilter> = {}
): CloudWatchLogs.SubscriptionFilter => {
  const defaults: CloudWatchLogs.SubscriptionFilter = {
    destinationArn: 'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
    filterName: 'ExampleStepFunction-DdCiLogGroupSubscription',
    filterPattern: '',
    logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
  }

  return {...defaults, ...props}
}
