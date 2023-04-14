import AWS from 'aws-sdk'
import {CloudWatchLogs, StepFunctions} from 'aws-sdk'
import AWSMock from 'aws-sdk-mock' // use aws-sdk-client-mock when migrating to AWS SDK for JavaScript v3

import {
  createLogGroup,
  deleteSubscriptionFilter,
  enableStepFunctionLogs,
  describeStateMachine,
  listTagsForResource,
  describeSubscriptionFilters,
  putSubscriptionFilter,
  tagResource,
  untagResource,
} from '../aws'

import {
  cloudWatchLogsClientFixture,
  logGroupFixture,
  stepFunctionsClientFixture,
  stepFunctionFixture,
  stepFunctionTagListFixture,
  subscriptionFilterFixture,
} from './fixtures/aws-resources'

describe('aws', () => {
  describe('cloudwatch logs', () => {
    describe('createLogGroup', () => {
      test('creates createLogGroup request', () => {
        const cloudWatchLogsClient = cloudWatchLogsClientFixture()
        const logGroup = logGroupFixture()
        const createLogGroupRequest = createLogGroup(cloudWatchLogsClient, logGroup.logGroupName ?? '')

        expect(createLogGroupRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'createLogGroup',
            params: {
              logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
            },
          }),
        })
      })
    })

    describe('deleteSubscriptionFilter', () => {
      test('creates deleteSubscriptionFilter request', () => {
        const cloudWatchLogsClient = cloudWatchLogsClientFixture()
        const logGroup = logGroupFixture()
        const subscriptionFilter = subscriptionFilterFixture()
        const deleteSubscriptionFilterRequest = deleteSubscriptionFilter(
          cloudWatchLogsClient,
          subscriptionFilter.filterName ?? '',
          logGroup.logGroupName ?? ''
        )

        expect(deleteSubscriptionFilterRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'deleteSubscriptionFilter',
            params: {
              filterName: 'ExampleStepFunctionLogGroupSubscription',
              logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
            },
          }),
        })
      })
    })

    describe('describeSubscriptionFilters', () => {
      test('gets subscription filters', async () => {
        AWSMock.setSDKInstance(AWS)
        AWSMock.mock(
          'CloudWatchLogs',
          'describeSubscriptionFilters',
          (
            params: CloudWatchLogs.DescribeSubscriptionFiltersRequest,
            callback: (arg0: undefined, arg1: CloudWatchLogs.DescribeSubscriptionFiltersResponse) => void
          ) => {
            callback(undefined, {subscriptionFilters: [subscriptionFilterFixture({logGroupName: params.logGroupName})]})
          }
        )

        const cloudWatchLogsClient = cloudWatchLogsClientFixture()
        const logGroupName = '/aws/vendedlogs/states/ExampleStepFunction-Logs-test-Mock'
        const describeSubscriptionFiltersResponse = await describeSubscriptionFilters(
          cloudWatchLogsClient,
          logGroupName
        )

        expect(describeSubscriptionFiltersResponse.subscriptionFilters).toMatchObject([
          {
            destinationArn: 'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
            filterName: 'ExampleStepFunctionLogGroupSubscription',
            filterPattern: '',
            logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test-Mock',
          },
        ])

        AWSMock.restore('CloudWatchLogs')
      })
    })

    describe('putSubscriptionFilter', () => {
      test('creates putSubscriptionFilter request', () => {
        const cloudWatchLogsClient = cloudWatchLogsClientFixture()
        const logGroup = logGroupFixture()
        const subscriptionFilter = subscriptionFilterFixture()
        const putSubscriptionFilterRequest = putSubscriptionFilter(
          cloudWatchLogsClient,
          subscriptionFilter.destinationArn ?? '',
          subscriptionFilter.filterName ?? '',
          logGroup.logGroupName ?? ''
        )

        expect(putSubscriptionFilterRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'putSubscriptionFilter',
            params: {
              destinationArn: 'arn:aws:lambda:us-east-1:000000000000:function:DatadogForwarder',
              filterName: 'ExampleStepFunctionLogGroupSubscription',
              filterPattern: '',
              logGroupName: '/aws/vendedlogs/states/ExampleStepFunction-Logs-test',
            },
          }),
        })
      })
    })
  })

  describe('step functions', () => {
    describe('enableStepFunctionLogs', () => {
      test('creates enableStepFunctionLogs request', () => {
        const stepFunctionsClient = stepFunctionsClientFixture()
        const loggingConfiguration = {
          level: 'OFF',
          includeExecutionData: false,
        }
        const stepFunction = stepFunctionFixture({loggingConfiguration})
        const logGroupArn =
          'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*'
        const enableStepFunctionLogsRequest = enableStepFunctionLogs(stepFunctionsClient, stepFunction, logGroupArn)

        expect(enableStepFunctionLogsRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'updateStateMachine',
            params: {
              stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
              loggingConfiguration: {
                destinations: [
                  {
                    cloudWatchLogsLogGroup: {
                      logGroupArn:
                        'arn:aws:logs:us-east-1:000000000000:log-group:/aws/vendedlogs/states/ExampleStepFunction-Logs-test:*',
                    },
                  },
                ],
                level: 'ALL',
                includeExecutionData: true,
              },
            },
          }),
          previousParams: {
            stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
            loggingConfiguration: {
              level: 'OFF',
              includeExecutionData: false,
            },
          },
        })
      })
    })

    describe('describeStateMachine', () => {
      test('gets step function', async () => {
        AWSMock.setSDKInstance(AWS)
        AWSMock.mock(
          'StepFunctions',
          'describeStateMachine',
          (
            params: StepFunctions.DescribeStateMachineInput,
            callback: (arg0: undefined, arg1: StepFunctions.DescribeStateMachineOutput) => void
          ) => {
            callback(undefined, stepFunctionFixture({stateMachineArn: params.stateMachineArn}))
          }
        )

        const stepFunctionsClient = stepFunctionsClientFixture()
        const stepFunctionArn = 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunctionMock'
        const stepFunction = await describeStateMachine(stepFunctionsClient, stepFunctionArn)

        expect(stepFunction).toMatchObject({
          stateMachineArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunctionMock',
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
        })

        AWSMock.restore('StepFunctions')
      })
    })

    describe('listTagsForResource', () => {
      test('gets a list of step function tags', async () => {
        AWSMock.setSDKInstance(AWS)
        AWSMock.mock(
          'StepFunctions',
          'listTagsForResource',
          (
            params: StepFunctions.ListTagsForResourceInput,
            callback: (arg0: undefined, arg1: StepFunctions.ListTagsForResourceOutput) => void
          ) => {
            callback(undefined, {tags: stepFunctionTagListFixture([{key: 'dd_sls_ci', value: 'v0.0.0'}])})
          }
        )

        const stepFunctionsClient = stepFunctionsClientFixture()
        const stepFunction = stepFunctionFixture()
        const listStepFunctionTagsResponse = await listTagsForResource(
          stepFunctionsClient,
          stepFunction.stateMachineArn
        )

        expect(listStepFunctionTagsResponse).toMatchObject({
          tags: [
            {key: 'env', value: 'test'},
            {key: 'dd_sls_ci', value: 'v0.0.0'},
          ],
        })

        AWSMock.restore('StepFunctions')
      })
    })

    describe('tagResource', () => {
      test('creates tagStepFunction request', () => {
        const stepFunctionsClient = stepFunctionsClientFixture()
        const stepFunction = stepFunctionFixture()
        const tagsToAdd = [{key: 'dd_sls_ci', value: 'v0.0.0'}]
        const tagStepFunctionRequest = tagResource(stepFunctionsClient, stepFunction.stateMachineArn, tagsToAdd)

        expect(tagStepFunctionRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'tagResource',
            params: {
              resourceArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
              tags: [{key: 'dd_sls_ci', value: `v0.0.0`}],
            },
          }),
        })
      })
    })

    describe('untagResource', () => {
      test('creates untagStepFunction request', () => {
        const stepFunctionsClient = stepFunctionsClientFixture()
        const stepFunction = stepFunctionFixture()
        const tagKeystoRemove = ['dd_sls_ci']
        const unTagStepFunctionRequest = untagResource(
          stepFunctionsClient,
          stepFunction.stateMachineArn,
          tagKeystoRemove
        )

        expect(unTagStepFunctionRequest).toMatchObject({
          function: expect.objectContaining({
            operation: 'untagResource',
            params: {
              resourceArn: 'arn:aws:states:us-east-1:000000000000:stateMachine:ExampleStepFunction',
              tagKeys: ['dd_sls_ci'],
            },
          }),
        })
      })
    })
  })
})
