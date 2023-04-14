import {StepFunctions} from 'aws-sdk'

export const buildArn = (
  partition: string,
  service: string,
  region: string,
  accountId: string,
  resourceType: string,
  resourceId: string
): string => {
  return `arn:${partition}:${service}:${region}:${accountId}:${resourceType}:${resourceId}`
}

export const buildLogGroupName = (stepFunctionName: string, env: string | undefined): string => {
  return `/aws/vendedlogs/states/${stepFunctionName}-Logs${env !== undefined ? '-' + env : ''}`
}

export const DD_CI_IDENTIFING_STRING = 'DdCiLogGroupSubscription'
export const buildSubscriptionFilterName = (stepFunctionName: string): string => {
  return `${stepFunctionName}-${DD_CI_IDENTIFING_STRING}`
}

export const isValidArn = (str: string): boolean => {
  const arnFields = str.split(':')

  return arnFields.length >= 7 && arnFields[0] === 'arn'
}

export const getStepFunctionLogGroupArn = (
  stepFunction: StepFunctions.DescribeStateMachineOutput
): string | undefined => {
  const [logDestinations] = stepFunction.loggingConfiguration?.destinations ?? [{cloudWatchLogsLogGroup: {}}]

  return logDestinations.cloudWatchLogsLogGroup?.logGroupArn
}

export const parseArn = (
  arn: string
): {
  partition: string
  region: string
  accountId: string
  resourceName: string
} => {
  const [, partition, , region, accountId, , resourceName] = arn.split(':')

  return {
    partition,
    region,
    accountId,
    resourceName,
  }
}
