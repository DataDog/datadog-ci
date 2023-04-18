import {AWSError, CloudWatchLogs, Request, StepFunctions} from 'aws-sdk'
import {
  DescribeStateMachineCommand, ListTagsForResourceCommand,
  TagResourceCommand,
  TagResourceCommandOutput,
  UntagResourceCommand, UpdateStateMachineCommand
} from "@aws-sdk/client-sfn";
import {SFNClient} from "@aws-sdk/client-sfn/dist-types/SFNClient";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteSubscriptionFilterCommand
} from "@aws-sdk/client-cloudwatch-logs";
import {CreatePolicyCommand} from "@aws-sdk/client-iam";
import {Command as $Command} from "@aws-sdk/smithy-client/dist-types/command";
import {Command} from "@aws-sdk/types";

export interface AWSRequest {
  function:
    | Request<Record<string, unknown>, AWSError>
    | Request<StepFunctions.UpdateStateMachineOutput, AWSError>
    | Request<StepFunctions.TagResourceOutput, AWSError>
    | Request<StepFunctions.UntagResourceOutput, AWSError>
  previousParams?: StepFunctions.UpdateStateMachineInput
}

export interface AWSClientAndRequest {
  client: SFNClient | CloudWatchLogsClient
  command: Command<any, any, any, any, any>
  // command: TagResourceCommand | CreateLogGroupCommand | DeleteSubscriptionFilterCommand | UpdateStateMachineCommand | CreatePolicyCommand |
  params: any
  previousParams?: any
}

export interface AWSRequestMetadata {
  operation: string
  params:
    | CloudWatchLogs.CreateLogGroupRequest
    | CloudWatchLogs.DeleteSubscriptionFilterRequest
    | CloudWatchLogs.PutSubscriptionFilterRequest
    | StepFunctions.TagResourceInput
    | StepFunctions.UntagResourceInput
    | StepFunctions.UpdateStateMachineInput
}

export interface RequestsByStepFunction {
  [stepFunctionArn: string]: AWSClientAndRequest[]
}
