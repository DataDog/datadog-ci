import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogGroupCommandOutput,
  DeleteSubscriptionFilterCommand,
  DescribeSubscriptionFiltersCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {AttachRolePolicyCommand, CreatePolicyCommand, IAMClient} from '@aws-sdk/client-iam'
import {
  DescribeStateMachineCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateStateMachineCommand,
  SFNClient, DescribeStateMachineCommandOutput,
} from '@aws-sdk/client-sfn'
import {mockClient} from 'aws-sdk-client-mock'

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
  createLogsAccessPolicy,
  buildLogAccessPolicyName,
  attachPolicyToStateMachineIamRole,
} from '../awsCommands'

import {
  cloudWatchLogsClientFixture,
  logGroupFixture,
  stepFunctionsClientFixture,
  stepFunctionFixture,
  stepFunctionTagListFixture,
  subscriptionFilterFixture,
  createMockContext,
} from './fixtures/aws-resources'

describe('awsCommands test', () => {
  const expectedResp = {fakeKey: 'fakeValue'} as any
  const fakeForwarderArn = 'fakeForwarderArn'
  const fakeFilterName = 'fakeFilterName'
  const fakeLogGroupName = 'fakeLogGroupName'
  const fakeStepFunctionArn = 'arn:aws:states:sa-east-1:1234567890:stateMachine:UnitTestStateMachineName'
  const fakeStateMachineName = 'UnitTestStateMachineName'
  const fakeAccountId = '123456789012'
  const fakeRoleArn = `arn:aws:iam::${fakeAccountId}:role/unit-test-fake-role-name`

  const mockedCloudWatchLogsClient = mockClient(CloudWatchLogsClient)
  const mockedIamClient = mockClient(IAMClient)
  const mockedStepFunctionsClient = mockClient(SFNClient)
  let mockedContext: any

  beforeEach(() => {
    mockedStepFunctionsClient.reset()
    mockedCloudWatchLogsClient.reset()
    mockedIamClient.reset()
    jest.resetModules()
    process.env = {}

    mockedContext = createMockContext()

    mockedIamClient.on(AttachRolePolicyCommand).resolves({})
    mockedIamClient.on(CreatePolicyCommand).resolves({})
  })
  test('listTagsForResource test', async () => {
    mockedStepFunctionsClient.on(ListTagsForResourceCommand, {resourceArn: fakeStepFunctionArn}).resolves(expectedResp)
    const actual = await listTagsForResource(new SFNClient({}), fakeStepFunctionArn)
    expect(actual).toEqual(expectedResp)
  })

  test('putSubscriptionFilter test', async () => {
    const input = {
      destinationArn: fakeForwarderArn,
      filterName: fakeFilterName,
      filterPattern: '',
      logGroupName: fakeLogGroupName,
    }
    mockedCloudWatchLogsClient.on(PutSubscriptionFilterCommand, input).resolves(expectedResp)

    const actual = await putSubscriptionFilter(
      new CloudWatchLogsClient({}),
      fakeForwarderArn,
      fakeFilterName,
      fakeLogGroupName,
      fakeStepFunctionArn,
      mockedContext,
      false
    )

    expect(actual).toEqual(expectedResp)
  })

  test('tagResource test', async () => {
    const fakeTags = [{key: 'key1', val: 'val1'}]
    const input = {
      resourceArn: fakeStepFunctionArn,
      tags: fakeTags,
    }

    mockedStepFunctionsClient.on(TagResourceCommand, input).resolves(expectedResp)

    const actual = await tagResource(new SFNClient({}), fakeStepFunctionArn, fakeTags, mockedContext, false)

    expect(actual).toEqual(expectedResp)
  })

  test('createLogGroup test', async () => {
    mockedCloudWatchLogsClient.on(CreateLogGroupCommand, {logGroupName: fakeLogGroupName}).resolves(expectedResp)
    const actual = await createLogGroup(
      new CloudWatchLogsClient({}),
      fakeLogGroupName,
      'fakeStepFunctionArn',
      mockedContext,
      false
    )
    expect(actual).toEqual(expectedResp)
  })

  test('createLogsAccessPolicy test', async () => {
    const describeStateMachineCommandOutput: DescribeStateMachineCommandOutput = {
      $metadata: {},
      creationDate: undefined,
      definition: undefined,
      roleArn: undefined,
      type: undefined,
      stateMachineArn: fakeStepFunctionArn,
      name: fakeStateMachineName,
    }

    const logsAccessPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'logs:CreateLogDelivery',
            'logs:CreateLogStream',
            'logs:GetLogDelivery',
            'logs:UpdateLogDelivery',
            'logs:DeleteLogDelivery',
            'logs:ListLogDeliveries',
            'logs:PutLogEvents',
            'logs:PutResourcePolicy',
            'logs:DescribeResourcePolicies',
            'logs:DescribeLogGroups',
          ],
          Resource: '*',
        },
      ],
    }

    const input = {
      PolicyDocument: JSON.stringify(logsAccessPolicy),
      PolicyName: buildLogAccessPolicyName(describeStateMachineCommandOutput),
    }

    mockedIamClient.on(CreatePolicyCommand, input).resolves(expectedResp)

    const actual = await createLogsAccessPolicy(
      new IAMClient({}),
      describeStateMachineCommandOutput,
      fakeStepFunctionArn,
      mockedContext,
      false
    )
    expect(actual).toEqual(expectedResp)
  })

  test('createLogsAccessPolicy test', async () => {
    const describeStateMachineCommandOutput: DescribeStateMachineCommandOutput = {
      $metadata: {},
      creationDate: undefined,
      definition: undefined,
      roleArn: fakeRoleArn,
      type: undefined,
      stateMachineArn: fakeStepFunctionArn,
      name: fakeStateMachineName,
    }

    const input = {
      PolicyArn: `arn:aws:iam::${fakeAccountId}:policy/LogsDeliveryAccessPolicy-${fakeStateMachineName}`,
      RoleName: 'unit-test-fake-role-name',
    }

    mockedIamClient.on(AttachRolePolicyCommand, input).resolves(expectedResp)

    const actual = await attachPolicyToStateMachineIamRole(
      new IAMClient({}),
      describeStateMachineCommandOutput,
      fakeAccountId,
      fakeStepFunctionArn,
      mockedContext,
      false
    )
    expect(actual).toEqual(expectedResp)
  })

  // todo: next is enableStepFunctionLogs
})
