import {CloudWatchLogs, StepFunctions} from 'aws-sdk'

import {instrumentationSourceTagKey, instrumentationSourceTagValue, Operation} from './constants'
import {
  CreateLogGroupRequest,
  DeleteSubscriptionFilterRequest,
  PutSubscriptionFilterRequest,
  TagLogGroupRequest,
  TagStepFunctionRequest,
  UntagLogGroupRequest,
  UpdateStepFunctionRequest,
} from './interfaces'

export const createLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): CreateLogGroupRequest => {
  const params = {
    logGroupName,
    tags: {
      [instrumentationSourceTagKey]: instrumentationSourceTagValue,
    },
  }

  return {
    function: cloudWatchLogsClient.createLogGroup(params),
    operation: Operation.CreateLogGroup,
    params,
  }
}

export const deleteSubscriptionFilter = (
  cloudWatchLogsClient: CloudWatchLogs,
  filterName: string,
  logGroupName: string
): DeleteSubscriptionFilterRequest => {
  const params = {
    filterName,
    logGroupName,
  }

  return {
    function: cloudWatchLogsClient.deleteSubscriptionFilter(params),
    operation: Operation.DeleteSubscriptionFilter,
    params,
  }
}

export const enableStepFunctionLogs = (
  stepFunctionsClient: StepFunctions,
  stepFunction: StepFunctions.DescribeStateMachineOutput,
  logGroupArn: string
): UpdateStepFunctionRequest => {
  const params = {
    stateMachineArn: stepFunction.stateMachineArn,
    loggingConfiguration: {
      destinations: [{cloudWatchLogsLogGroup: {logGroupArn}}],
      level: 'ALL',
      includeExecutionData: true,
    },
  }

  return {
    function: stepFunctionsClient.updateStateMachine(params),
    operation: Operation.UpdateStateMachine,
    params,
    previousParams: {
      stateMachineArn: stepFunction.stateMachineArn,
      loggingConfiguration: stepFunction.loggingConfiguration,
    },
  }
}

export const getStepFunction = async (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string
): Promise<StepFunctions.DescribeStateMachineOutput> => {
  return stepFunctionsClient.describeStateMachine({stateMachineArn: stepFunctionArn}).promise()
}

export const listSubscriptionFilters = (
  cloudWatchLogsClient: CloudWatchLogs,
  logGroupName: string
): Promise<CloudWatchLogs.DescribeSubscriptionFiltersResponse> => {
  return cloudWatchLogsClient.describeSubscriptionFilters({logGroupName}).promise()
}

export const listStepFunctionTags = async (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string
): Promise<StepFunctions.ListTagsForResourceOutput> => {
  return stepFunctionsClient.listTagsForResource({resourceArn: stepFunctionArn}).promise()
}

export const putSubscriptionFilter = (
  cloudWatchLogsClient: CloudWatchLogs,
  forwarderArn: string,
  filterName: string,
  logGroupName: string
): PutSubscriptionFilterRequest => {
  const params = {
    destinationArn: forwarderArn,
    filterName,
    filterPattern: '',
    logGroupName,
  }

  return {
    function: cloudWatchLogsClient.putSubscriptionFilter(params),
    operation: Operation.PutSubscriptionFilter,
    params,
  }
}

export const tagLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): TagLogGroupRequest => {
  const params = {
    logGroupName,
    tags: {
      [instrumentationSourceTagKey]: instrumentationSourceTagValue,
    },
  }

  return {
    function: cloudWatchLogsClient.tagLogGroup(params), // changed to tagResource in AWS SDK for JavaScript v3
    operation: Operation.TagLogGroup,
    params,
  }
}

export const tagStepFunction = (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string,
  tags: {key: string; value: string}[]
): TagStepFunctionRequest => {
  const params = {
    resourceArn: stepFunctionArn,
    tags,
  }

  return {
    function: stepFunctionsClient.tagResource(params),
    operation: Operation.TagResource,
    params,
  }
}

export const untagLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): UntagLogGroupRequest => {
  const params = {
    logGroupName,
    tags: [instrumentationSourceTagKey],
  }

  return {
    function: cloudWatchLogsClient.untagLogGroup(params), // changed to untagResource in AWS SDK for JavaScript v3
    operation: Operation.UntagLogGroup,
    params,
  }
}
