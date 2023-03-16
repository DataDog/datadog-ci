import {AWSError, CloudWatchLogs, Request, StepFunctions} from 'aws-sdk'

export interface AWSRequest {
  function:
    | Request<Record<string, unknown>, AWSError>
    | Request<StepFunctions.UpdateStateMachineOutput, AWSError>
    | Request<StepFunctions.TagResourceOutput, AWSError>
    | Request<StepFunctions.UntagResourceOutput, AWSError>
  previousParams?: StepFunctions.UpdateStateMachineInput
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
  [stepFunctionArn: string]: AWSRequest[]
}
