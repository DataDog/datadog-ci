import {CloudWatchLogs, StepFunctions} from 'aws-sdk'

import {AWSRequest} from './interfaces'

export const createLogGroup = (cloudWatchLogsClient: CloudWatchLogs, logGroupName: string): AWSRequest => {
  const params = {
    logGroupName,
  }

  return {
    function: cloudWatchLogsClient.createLogGroup(params),
  }
}

export const deleteSubscriptionFilter = (
  cloudWatchLogsClient: CloudWatchLogs,
  filterName: string,
  logGroupName: string
): AWSRequest => {
  const params = {
    filterName,
    logGroupName,
  }

  return {
    function: cloudWatchLogsClient.deleteSubscriptionFilter(params),
  }
}

export const enableStepFunctionLogs = (
  stepFunctionsClient: StepFunctions,
  stepFunction: StepFunctions.DescribeStateMachineOutput,
  logGroupArn: string
): AWSRequest => {
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
    previousParams: {
      stateMachineArn: stepFunction.stateMachineArn,
      loggingConfiguration: stepFunction.loggingConfiguration,
    },
  }
}

export const describeStateMachine = async (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string
): Promise<StepFunctions.DescribeStateMachineOutput> => {
  const params = {stateMachineArn: stepFunctionArn}

  return stepFunctionsClient.describeStateMachine(params).promise()
}

export const describeSubscriptionFilters = (
  cloudWatchLogsClient: CloudWatchLogs,
  logGroupName: string
): Promise<CloudWatchLogs.DescribeSubscriptionFiltersResponse> => {
  const params = {logGroupName}

  return cloudWatchLogsClient.describeSubscriptionFilters(params).promise()
}

export const listTagsForResource = async (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string
): Promise<StepFunctions.ListTagsForResourceOutput> => {
  const params = {resourceArn: stepFunctionArn}

  return stepFunctionsClient.listTagsForResource(params).promise()
}

export const putSubscriptionFilter = (
  cloudWatchLogsClient: CloudWatchLogs,
  forwarderArn: string,
  filterName: string,
  logGroupName: string
): AWSRequest => {
  const params = {
    destinationArn: forwarderArn,
    filterName,
    filterPattern: '',
    logGroupName,
  }

  return {
    function: cloudWatchLogsClient.putSubscriptionFilter(params),
  }
}

export const tagResource = (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string,
  tags: StepFunctions.TagList
): AWSRequest => {
  const params = {
    resourceArn: stepFunctionArn,
    tags,
  }

  return {
    function: stepFunctionsClient.tagResource(params),
  }
}

export const untagResource = (
  stepFunctionsClient: StepFunctions,
  stepFunctionArn: string,
  tagKeys: StepFunctions.TagKeyList
): AWSRequest => {
  const params = {
    resourceArn: stepFunctionArn,
    tagKeys,
  }

  return {
    function: stepFunctionsClient.untagResource(params),
  }
}
