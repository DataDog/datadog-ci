import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteSubscriptionFilterCommand, DescribeSubscriptionFiltersCommand, PutSubscriptionFilterCommand
} from '@aws-sdk/client-cloudwatch-logs'
import {DescribeStateMachineCommand, ListTagsForResourceCommand, TagResourceCommand} from '@aws-sdk/client-sfn'
import {SFNClient} from '@aws-sdk/client-sfn/dist-types/SFNClient'
import {
  DescribeStateMachineCommandOutput,
  ListTagsForResourceCommandOutput,
  Tag
} from '@aws-sdk/client-sfn/dist-types/ts3.4'
import {CreatePolicyCommand, IAMClient} from '@aws-sdk/client-iam'
import {AWSClientAndRequest} from './interfaces'
import {
  DescribeSubscriptionFiltersCommandOutput
} from "@aws-sdk/client-cloudwatch-logs/dist-types/ts3.4";
import {displayChanges2} from "./changes";
import {BaseContext} from "clipanion";


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
  displayChanges2(stepFunctionArn, context, commandName, dryRun)
  void cloudWatchLogsClient.send(command)
  printSuccessfulMessage(commandName)
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
  displayChanges2(stepFunctionArn, context, commandName, dryRun)
  void stepFunctionsClient.send(command)
  printSuccessfulMessage(commandName)
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
  displayChanges2(stepFunctionArn, context, commandName, dryRun)
  void cloudWatchLogsClient.send(command)
  printSuccessfulMessage(commandName)
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

// export const enableStepFunctionLogs = (
//   stepFunctionsClient: SFNClient,
//   stepFunction: StepFunctions.DescribeStateMachineOutput,
//   logGroupArn: string
// ): AWSClientAndRequest => {
//   const params = {
//     stateMachineArn: stepFunction.stateMachineArn,
//     loggingConfiguration: {
//       destinations: [{cloudWatchLogsLogGroup: {logGroupArn}}],
//       level: 'ALL',
//       includeExecutionData: true,
//     },
//   }
//
//   return {
//     client: stepFunctionsClient,
//     params,
//     command: new UpdateStateMachineCommand(params),
//     previousParams: {
//       stateMachineArn: stepFunction.stateMachineArn,
//       loggingConfiguration: stepFunction.loggingConfiguration,
//     },
//   }
// }

// export const createLogsAccessPolicy = (
//   iamClient: IAMClient,
//   stepFunction: DescribeStateMachineCommandOutput
// ): AWSClientAndRequest => {
//   // according to https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html#cloudwatch-iam-policy
//   const logsAccessPolicy = {
//     Version: '2012-10-17',
//     Statement: [
//       {
//         Effect: 'Allow',
//         Action: [
//           'logs:CreateLogDelivery',
//           'logs:CreateLogStream',
//           'logs:GetLogDelivery',
//           'logs:UpdateLogDelivery',
//           'logs:DeleteLogDelivery',
//           'logs:ListLogDeliveries',
//           'logs:PutLogEvents',
//           'logs:PutResourcePolicy',
//           'logs:DescribeResourcePolicies',
//           'logs:DescribeLogGroups',
//         ],
//         Resource: '*',
//       },
//     ],
//   }
//
//   const params = {
//     PolicyDocument: JSON.stringify(logsAccessPolicy),
//     PolicyName: buildLogAccessPolicyName(stepFunction),
//   }
//   const command = new CreatePolicyCommand(params)
//
//   return {
//     client: iamClient,
//     command: command,
//     params: params,
//   }
//   // return {
//   //   function: iamClient.createPolicy(params),
//   // }
// }

const buildLogAccessPolicyName = (stepFunction: DescribeStateMachineCommandOutput): string => {
  return `LogsDeliveryAccessPolicy-${stepFunction.name}`
}

// export const attachPolicyToStateMachineIamRole = (
//   iamClient: IAM,
//   stepFunction: DescribeStateMachineCommandOutput,
//   accountId: string
// ): AWSClientAndRequest => {
//   const roleName = stepFunction?.roleArn?.split('/')[1]
//   const policyArn = `arn:aws:iam::${accountId}:policy/${buildLogAccessPolicyName(stepFunction)}`
//
//   const params = {
//     PolicyArn: policyArn,
//     RoleName: roleName,
//   }
//
//   return {
//     function: iamClient.attachRolePolicy(params),
//   }
// }

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


const printSuccessfulMessage = (commandName: string): void => {
  console.log(`${commandName} finished successfully`)
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
