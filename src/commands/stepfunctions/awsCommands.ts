import {
  CloudWatchLogsClient,
  CreateLogGroupCommand, CreateLogGroupCommandOutput,
  DeleteSubscriptionFilterCommand,
  DescribeSubscriptionFiltersCommand,
  DescribeSubscriptionFiltersCommandOutput,
  PutSubscriptionFilterCommand, PutSubscriptionFilterCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  AttachRolePolicyCommand, AttachRolePolicyCommandOutput,
  CreatePolicyCommand,
  CreatePolicyCommandOutput,
  IAMClient
} from '@aws-sdk/client-iam'
import {
  DescribeStateMachineCommand,
  ListTagsForResourceCommand,
  TagResourceCommand, TagResourceCommandOutput,
  UntagResourceCommand,
  UpdateStateMachineCommand,
} from '@aws-sdk/client-sfn'
import {SFNClient} from '@aws-sdk/client-sfn/dist-types/SFNClient'
import {
  DescribeStateMachineCommandOutput,
  ListTagsForResourceCommandOutput,
  Tag,
} from '@aws-sdk/client-sfn/dist-types/ts3.4'
import {BaseContext} from 'clipanion'

import {displayChanges} from './helpers'

export const listTagsForResource = async (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string
): Promise<ListTagsForResourceCommandOutput> => {
  const params = {resourceArn: stepFunctionArn}
  const command = new ListTagsForResourceCommand(params)

  return stepFunctionsClient.send(command)
}

export const putSubscriptionFilter = async (
  cloudWatchLogsClient: CloudWatchLogsClient,
  forwarderArn: string,
  filterName: string,
  logGroupName: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<PutSubscriptionFilterCommandOutput | undefined> => {
  // Running this function multiple times would not create duplicate filters (old filter with the same name would be overwritten).
  // However, two filters with the same destination forwarder can exist when the filter names are different.

  const params = {
    destinationArn: forwarderArn,
    filterName,
    filterPattern: '',
    logGroupName,
  }
  const command = new PutSubscriptionFilterCommand(params)
  const commandName = 'PutSubscriptionFilter'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  if (!dryRun) {
    const data = await cloudWatchLogsClient.send(command)
    // Even if the same filter name is created before, the response is still 200.
    // there are no way to tell
    context.stdout.write(
      `Subscription filter ${filterName} is created or the original filter ${filterName} is overwritten.\nt`
    )

    return data
  }
}

export const tagResource = async (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string,
  tags: Tag[],
  context: BaseContext,
  dryRun: boolean
): Promise<TagResourceCommandOutput | undefined> => {
  const params = {
    resourceArn: stepFunctionArn,
    tags,
  }

  const command = new TagResourceCommand(params)
  const commandName = 'TagResource'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  if (!dryRun) {
    const data = stepFunctionsClient.send(command)
    printSuccessfulMessage(commandName, context)

    return data
  }
}

export const createLogGroup = async (
  cloudWatchLogsClient: CloudWatchLogsClient,
  logGroupName: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<CreateLogGroupCommandOutput | undefined> => {
  const params = {
    logGroupName,
  }
  const command = new CreateLogGroupCommand(params)
  const commandName = 'CreateLogGroup'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  try {
    if (!dryRun) {
      const data = await cloudWatchLogsClient.send(command)
      printSuccessfulMessage(commandName, context)

      return data
    }
  } catch (err) {
    // if a resource already exists it's a warning since we can use that resource instead of creating it
    if (err instanceof Error) {
      if (err.name === 'ResourceAlreadyExistsException') {
        context.stdout.write(
          ` -> [Info] ${err.message}. Skipping resource creation and continuing with instrumentation.\n`
        )
      }
    } else {
      context.stdout.write(` -> [Error] ${err.message}`)
    }
  }
}

export const createLogsAccessPolicy = async (
  iamClient: IAMClient,
  describeStateMachineCommandOutput: DescribeStateMachineCommandOutput,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<CreatePolicyCommandOutput | undefined> => {
  // according to https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html#cloudwatch-iam-policy
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

  const params = {
    PolicyDocument: JSON.stringify(logsAccessPolicy),
    PolicyName: buildLogAccessPolicyName(describeStateMachineCommandOutput),
  }
  const command = new CreatePolicyCommand(params)
  const commandName = 'CreatePolicy'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  try {
    if (!dryRun) {
      const data = await iamClient.send(command)
      printSuccessfulMessage(commandName, context)

      return data
    }
  } catch (err) {
    // if a resource already exists it's a warning since we can use that resource instead of creating it
    if (err instanceof Error) {
      if (err.name === 'ResourceAlreadyExistsException') {
        context.stdout.write(
          ` -> [Info] ${err.message}. Skipping resource creation and continuing with instrumentation.\n`
        )
      }
    } else {
      context.stdout.write(` -> [Error] ${err.message}`)
    }
  }
}

export const attachPolicyToStateMachineIamRole = async (
  iamClient: IAMClient,
  describeStateMachineCommandOutput: DescribeStateMachineCommandOutput,
  accountId: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<AttachRolePolicyCommandOutput | undefined> => {
  const roleName = describeStateMachineCommandOutput?.roleArn?.split('/')[1]
  const policyArn = `arn:aws:iam::${accountId}:policy/${buildLogAccessPolicyName(describeStateMachineCommandOutput)}`

  const params = {
    PolicyArn: policyArn,
    RoleName: roleName,
  }

  const command = new AttachRolePolicyCommand(params)
  const commandName = 'AttachRolePolicy'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  if (!dryRun) {
    const data = await iamClient.send(command)
    printSuccessfulMessage(commandName, context)

    return data
  }
}

export const enableStepFunctionLogs = async (
  stepFunctionsClient: SFNClient,
  stepFunction: DescribeStateMachineCommandOutput,
  logGroupArn: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<void> => {
  const params = {
    stateMachineArn: stepFunction.stateMachineArn,
    loggingConfiguration: {
      destinations: [{cloudWatchLogsLogGroup: {logGroupArn}}],
      level: 'ALL',
      includeExecutionData: true,
    },
  }

  const previousParams = {
    stateMachineArn: stepFunction.stateMachineArn,
    loggingConfiguration: stepFunction.loggingConfiguration,
  }

  const command = new UpdateStateMachineCommand(params)
  const commandName = 'UpdateStateMachine'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params, previousParams)
  if (!dryRun) {
    await stepFunctionsClient.send(command)
    printSuccessfulMessage(commandName, context)
  }
}

export const deleteSubscriptionFilter = async (
  cloudWatchLogsClient: CloudWatchLogsClient,
  filterName: string,
  logGroupName: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<void> => {
  const params = {
    filterName,
    logGroupName,
  }

  const command = new DeleteSubscriptionFilterCommand(params)
  const commandName = 'DeleteSubscriptionFilter'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  if (!dryRun) {
    await cloudWatchLogsClient.send(command)
    printSuccessfulMessage(commandName, context)
  }
}

export const buildLogAccessPolicyName = (stepFunction: DescribeStateMachineCommandOutput): string => {
  return `LogsDeliveryAccessPolicy-${stepFunction.name}`
}

export const describeStateMachine = async (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string
): Promise<DescribeStateMachineCommandOutput> => {
  const params = {stateMachineArn: stepFunctionArn}
  const command = new DescribeStateMachineCommand(params)

  return stepFunctionsClient.send(command)
}

export const describeSubscriptionFilters = (
  cloudWatchLogsClient: CloudWatchLogsClient,
  logGroupName: string
): Promise<DescribeSubscriptionFiltersCommandOutput> => {
  const params = {logGroupName}
  const command = new DescribeSubscriptionFiltersCommand(params)

  return cloudWatchLogsClient.send(command)
}

const printSuccessfulMessage = (commandName: string, context: BaseContext): void => {
  context.stdout.write(`${commandName} finished successfully \n\n`)
}

export const untagResource = async (
  stepFunctionsClient: SFNClient,
  tagKeys: string[],
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<void> => {
  const params = {
    resourceArn: stepFunctionArn,
    tagKeys,
  }
  const command = new UntagResourceCommand(params)
  const commandName = 'UntagResource'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params)
  if (!dryRun) {
    await stepFunctionsClient.send(command)
    printSuccessfulMessage(commandName, context)
  }
}
