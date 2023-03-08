import {CloudWatchLogs, StepFunctions} from 'aws-sdk'

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
      DD_INSTRUMENTATION_SOURCE: 'datadog-ci',
    },
  }

  return {
    function: cloudWatchLogsClient.createLogGroup(params),
    operation: 'createLogGroup',
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
    operation: 'deleteSubscriptionFilter',
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
    operation: 'updateStateMachine',
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
    operation: 'putSubscriptionFilter',
    params,
  }
}

export const tagLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): TagLogGroupRequest => {
  const params = {
    logGroupName,
    tags: {
      DD_INSTRUMENTATION_SOURCE: 'datadog-ci',
    },
  }

  return {
    function: cloudWatchLogsClient.tagLogGroup(params), // changed to tagResource in AWS SDK for JavaScript v3
    operation: 'tagLogGroup',
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
    operation: 'tagResource',
    params,
  }
}

export const untagLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): UntagLogGroupRequest => {
  const params = {
    logGroupName,
    tags: ['DD_INSTRUMENTATION_SOURCE'],
  }

  return {
    function: cloudWatchLogsClient.untagLogGroup(params), // changed to untagResource in AWS SDK for JavaScript v3
    operation: 'untagLogGroup',
    params,
  }
}
