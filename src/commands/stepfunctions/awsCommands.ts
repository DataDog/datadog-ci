import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  PutSubscriptionFilterCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import {AttachRolePolicyCommand, CreatePolicyCommand, IAMClient} from '@aws-sdk/client-iam'
import {
  DescribeStateMachineCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UpdateStateMachineCommand
} from '@aws-sdk/client-sfn'
import {SFNClient} from '@aws-sdk/client-sfn/dist-types/SFNClient'
import {
  DescribeStateMachineCommandOutput,
  ListTagsForResourceCommandOutput,
  Tag,
} from '@aws-sdk/client-sfn/dist-types/ts3.4'
import {BaseContext} from 'clipanion'

import {displayChanges} from './changes'

export const listTagsForResource = async (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<ListTagsForResourceCommandOutput> => {
  const params = {resourceArn: stepFunctionArn}
  const command = new ListTagsForResourceCommand(params)

  return stepFunctionsClient.send(command)
}

export const putSubscriptionFilter = (
  cloudWatchLogsClient: CloudWatchLogsClient,
  forwarderArn: string,
  filterName: string,
  logGroupName: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): void => {
  const params = {
    destinationArn: forwarderArn,
    filterName,
    filterPattern: '',
    logGroupName,
  }
  const command = new PutSubscriptionFilterCommand(params)
  const commandName = 'PutSubscriptionFilter'
  displayChanges(stepFunctionArn, context, commandName, dryRun)

  try {
    void cloudWatchLogsClient.send(command)
  } catch (err) {
    // if a resource already exists it's a warning since we can use that resource instead of creating it
    if (err instanceof Error) {
      if (err.name === 'ResourceAlreadyExistsException') {
        context.stdout.write(
          ` -> [Info] ${err.message}. Skipping resource creation and continuing with instrumentation`
        )
      }
    } else {
      context.stdout.write(` -> [Error] ${err.message}`)
    }
  }
  printSuccessfulMessage(commandName, context)
}

export const tagResource = (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string,
  tags: Tag[],
  context: BaseContext,
  dryRun: boolean
): void => {
  const params = {
    resourceArn: stepFunctionArn,
    tags,
  }

  const command = new TagResourceCommand(params)
  const commandName = 'TagResource'
  displayChanges(stepFunctionArn, context, commandName, dryRun)
  void stepFunctionsClient.send(command)
  printSuccessfulMessage(commandName, context)
}

export const createLogGroup = (
  cloudWatchLogsClient: CloudWatchLogsClient,
  logGroupName: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): void => {
  const params = {
    logGroupName,
  }
  const command = new CreateLogGroupCommand(params)
  const commandName = 'CreateLogGroup'
  displayChanges(stepFunctionArn, context, commandName, dryRun)
  void cloudWatchLogsClient.send(command)
  printSuccessfulMessage(commandName, context)
}

export const createLogsAccessPolicy = (
  iamClient: IAMClient,
  stepFunction: DescribeStateMachineCommandOutput,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): void => {
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
    PolicyName: buildLogAccessPolicyName(stepFunction),
  }
  const command = new CreatePolicyCommand(params)
  const commandName = 'CreateLogGroup'
  displayChanges(stepFunctionArn, context, commandName, dryRun)
  void iamClient.send(command)
  printSuccessfulMessage(commandName, context)
}

export const attachPolicyToStateMachineIamRole = (
  iamClient: IAMClient,
  stepFunction: DescribeStateMachineCommandOutput,
  accountId: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): void => {
  const roleName = stepFunction?.roleArn?.split('/')[1]
  const policyArn = `arn:aws:iam::${accountId}:policy/${buildLogAccessPolicyName(stepFunction)}`

  const params = {
    PolicyArn: policyArn,
    RoleName: roleName,
  }

  const command = new AttachRolePolicyCommand(params)
  const commandName = 'CreateLogGroup'
  displayChanges(stepFunctionArn, context, commandName, dryRun)
  void iamClient.send(command)
  printSuccessfulMessage(commandName, context)
}

export const enableStepFunctionLogs = (
  stepFunctionsClient: SFNClient,
  stepFunction: DescribeStateMachineCommandOutput,
  logGroupArn: string,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): void => {
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
  const commandName = 'CreateLogGroup'
  displayChanges(stepFunctionArn, context, commandName, dryRun, params, previousParams)
  void stepFunctionsClient.send(command)
  printSuccessfulMessage(commandName, context)
  //
  // return {
  //   client: stepFunctionsClient,
  //   params,
  //   command: new UpdateStateMachineCommand(params),
  //   previousParams: {
  //     stateMachineArn: stepFunction.stateMachineArn,
  //     loggingConfiguration: stepFunction.loggingConfiguration,
  //   },
  // }
}

// export const deleteSubscriptionFilter = (
//   cloudWatchLogsClient: CloudWatchLogsClient,
//   filterName: string,
//   logGroupName: string
// ): AWSClientAndRequest => {
//   const params = {
//     filterName,
//     logGroupName,
//   }
//
//   const command = new DeleteSubscriptionFilterCommand(params)
//   return {
//     client: cloudWatchLogsClient,
//     command: command,
//     params: params,
//   }
//
//   // return {
//   //   function: cloudWatchLogsClient.deleteSubscriptionFilter(params),
//   // }
// }

const buildLogAccessPolicyName = (stepFunction: DescribeStateMachineCommandOutput): string => {
  return `LogsDeliveryAccessPolicy-${stepFunction.name}`
}

export const describeStateMachine = async (
  stepFunctionsClient: SFNClient,
  stepFunctionArn: string,
  context: BaseContext,
  dryRun: boolean
): Promise<DescribeStateMachineCommandOutput> => {
  const params = {stateMachineArn: stepFunctionArn}
  const command = new DescribeStateMachineCommand(params)

  return stepFunctionsClient.send(command)
}

// export const describeSubscriptionFilters = (
//   cloudWatchLogsClient: CloudWatchLogs,
//   logGroupName: string
// ): Promise<DescribeSubscriptionFiltersCommandOutput> => {
//   const params = {logGroupName}
//   const command = new DescribeSubscriptionFiltersCommand(params)
//
//   return cloudWatchLogsClient.send(command)
//   // return cloudWatchLogsClient.describeSubscriptionFilters(params).promise()
// }

const printSuccessfulMessage = (commandName: string, context: BaseContext): void => {
  context.stdout.write(`${commandName} finished successfully \n\n`)
}

// export const untagResource = (
//   stepFunctionsClient: SFNClient,
//   stepFunctionArn: string,
//   tagKeys: StepFunctions.TagKeyList
// ): AWSClientAndRequest => {
//   const params = {
//     resourceArn: stepFunctionArn,
//     tagKeys,
//   }
//
//   const command = new UntagResourceCommand(params)
//
//   return {
//     client: stepFunctionsClient,
//     command,
//     params,
//   }
// }
