import {AWSError, Request as AWSRequest, CloudWatchLogs, StepFunctions} from 'aws-sdk'

import {Operation} from './constants'

export interface Request {
  operation: Operation
}

export interface CreateLogGroupRequest extends Request {
  function: AWSRequest<Record<string, unknown>, AWSError>
  params: CloudWatchLogs.CreateLogGroupRequest
}

export interface DeleteSubscriptionFilterRequest extends Request {
  function: AWSRequest<Record<string, unknown>, AWSError>
  params: CloudWatchLogs.DeleteSubscriptionFilterRequest
}

export interface PutSubscriptionFilterRequest extends Request {
  function: AWSRequest<Record<string, unknown>, AWSError>
  params: CloudWatchLogs.PutSubscriptionFilterRequest
}

export interface TagStepFunctionRequest extends Request {
  function: AWSRequest<StepFunctions.TagResourceOutput, AWSError>
  params: StepFunctions.TagResourceInput
}

export interface UntagStepFunctionRequest extends Request {
  function: AWSRequest<StepFunctions.UntagResourceOutput, AWSError>
  params: StepFunctions.UntagResourceInput
}

export interface UpdateStepFunctionRequest extends Request {
  function: AWSRequest<StepFunctions.UpdateStateMachineOutput, AWSError>
  params: StepFunctions.UpdateStateMachineInput
  previousParams: StepFunctions.UpdateStateMachineInput
}
