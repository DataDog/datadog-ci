import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteSubscriptionFilterCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {AttachRolePolicyCommand, CreatePolicyCommand, IAMClient} from '@aws-sdk/client-iam'
import {
  DescribeStateMachineCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateStateMachineCommand,
  SFNClient,
  DescribeStateMachineCommandOutput,
  LogLevel,
} from '@aws-sdk/client-sfn'
import {mockClient} from 'aws-sdk-client-mock'

import {createMockContext} from '../../../helpers/__tests__/testing-tools'

import {
  createLogGroup,
  deleteSubscriptionFilter,
  enableStepFunctionLogs,
  describeStateMachine,
  listTagsForResource,
  putSubscriptionFilter,
  tagResource,
  untagResource,
  createLogsAccessPolicy,
  attachPolicyToStateMachineIamRole,
  updateStateMachineDefinition,
} from '../awsCommands'
import {buildLogAccessPolicyName, StateMachineDefinitionType} from '../helpers'

describe('awsCommands test', () => {
  const expectedResp = {fakeKey: 'fakeValue'} as any
  const fakeForwarderArn = 'fakeForwarderArn'
  const fakeFilterName = 'fakeFilterName'
  const fakeLogGroupName = 'fakeLogGroupName'
  const fakeLogGroupArn = 'fakeLogGroupArn'
  const fakeStepFunctionArn = 'arn:aws:states:sa-east-1:1234567890:stateMachine:UnitTestStateMachineName'
  const fakeStateMachineName = 'UnitTestStateMachineName'
  const fakeAccountId = '123456789012'
  const fakeRoleArn = `arn:aws:iam::${fakeAccountId}:role/unit-test-fake-role-name`

  const mockedCloudWatchLogsClient = mockClient(CloudWatchLogsClient)
  const mockedIamClient = mockClient(IAMClient)
  const mockedStepFunctionsClient = mockClient(SFNClient)
  let describeStateMachineCommandOutput: DescribeStateMachineCommandOutput
  let mockedContext: any

  beforeEach(() => {
    mockedStepFunctionsClient.reset()
    mockedCloudWatchLogsClient.reset()
    mockedIamClient.reset()
    jest.resetModules()
    process.env = {}

    mockedContext = createMockContext()

    describeStateMachineCommandOutput = {
      $metadata: {},
      creationDate: undefined,
      definition: undefined,
      roleArn: undefined,
      type: undefined,
      stateMachineArn: fakeStepFunctionArn,
      name: fakeStateMachineName,
    }
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
    const input = {logGroupName: fakeLogGroupName}
    mockedCloudWatchLogsClient.on(CreateLogGroupCommand, input).resolves(expectedResp)
    const actual = await createLogGroup(
      new CloudWatchLogsClient({}),
      fakeLogGroupName,
      fakeStepFunctionArn,
      mockedContext,
      false
    )
    expect(actual).toEqual(expectedResp)
  })

  test('deleteSubscriptionFilter test', async () => {
    const input = {
      filterName: fakeFilterName,
      logGroupName: fakeLogGroupName,
    }
    mockedCloudWatchLogsClient.on(DeleteSubscriptionFilterCommand, input).resolves(expectedResp)
    const actual = await deleteSubscriptionFilter(
      new CloudWatchLogsClient({}),
      fakeFilterName,
      fakeLogGroupName,
      fakeStepFunctionArn,
      mockedContext,
      false
    )
    expect(actual).toEqual(expectedResp)
  })

  test('createLogsAccessPolicy test', async () => {
    describeStateMachineCommandOutput = {
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

  test('attachPolicyToStateMachineIamRole test', async () => {
    describeStateMachineCommandOutput = {
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

  test('attachPolicyToStateMachineIamRole test two slashes role arn', async () => {
    describeStateMachineCommandOutput = {
      $metadata: {},
      creationDate: undefined,
      definition: undefined,
      roleArn: `arn:aws:iam::${fakeAccountId}:role/service-role/unit-test-fake-role-name`, // two slashes in the role ARN for standard SF
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

  test('enableStepFunctionLogs test', async () => {
    const input = {
      stateMachineArn: fakeStepFunctionArn,
      loggingConfiguration: {
        destinations: [{cloudWatchLogsLogGroup: {logGroupArn: fakeLogGroupArn}}],
        level: LogLevel.ALL,
        includeExecutionData: true,
      },
    }

    mockedStepFunctionsClient.on(UpdateStateMachineCommand, input).resolves(expectedResp)

    const actual = await enableStepFunctionLogs(
      new SFNClient({}),
      describeStateMachineCommandOutput,
      fakeLogGroupArn,
      fakeStepFunctionArn,
      mockedContext,
      false
    )

    expect(actual).toEqual(expectedResp)
  })

  test('updateStateMachineDefinition test', async () => {
    const definitionObj: StateMachineDefinitionType = {
      Comment: 'no comment',
      States: {},
    }
    const input = {
      stateMachineArn: fakeStepFunctionArn,
      definition: JSON.stringify(definitionObj),
    }

    mockedStepFunctionsClient.on(UpdateStateMachineCommand, input).resolves(expectedResp)

    const actual = await updateStateMachineDefinition(
      new SFNClient({}),
      describeStateMachineCommandOutput,
      definitionObj,
      mockedContext,
      false
    )

    expect(actual).toEqual(expectedResp)
  })

  test('describeStateMachine test', async () => {
    const input = {stateMachineArn: fakeStepFunctionArn}

    mockedStepFunctionsClient.on(DescribeStateMachineCommand, input).resolves(expectedResp)

    const actual = await describeStateMachine(new SFNClient({}), fakeStepFunctionArn)

    expect(actual).toEqual(expectedResp)
  })

  test('untagResource test', async () => {
    const fakeTagKeys = ['tagKey1', 'tagKey2']
    const input = {
      resourceArn: fakeStepFunctionArn,
      tagKeys: fakeTagKeys,
    }

    mockedStepFunctionsClient.on(UntagResourceCommand, input).resolves(expectedResp)

    const actual = await untagResource(new SFNClient({}), fakeTagKeys, fakeStepFunctionArn, mockedContext, false)

    expect(actual).toEqual(expectedResp)
  })
})
