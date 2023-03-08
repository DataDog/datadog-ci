import {StepFunctions} from 'aws-sdk'

export const buildArn = (
  partition: string,
  service: string,
  region: string,
  accountId: string,
  resourceType: string,
  resourceId: string
): string => {
  return `arn:${partition || 'aws'}:${service}:${region}:${accountId}:${resourceType}:${resourceId}`
}

export const buildLogGroupName = (stepFunctionName: string, env: string | undefined): string => {
  return `/aws/vendedlogs/states/${stepFunctionName}-Logs${env !== undefined ? '-' + env : ''}`
}

export const buildSubscriptionFilterName = (stepFunctionName: string): string => {
  return `${stepFunctionName}LogGroupSubscription`
}

export const isValidArn = (str: string | undefined): boolean => {
  return typeof str === 'string' && str.indexOf('arn:') === 0 && str.split(':').length >= 6
}

export const getStepFunctionLogGroupArn = (stepFunction: StepFunctions.DescribeStateMachineOutput): string => {
  const [logDestinations] = stepFunction.loggingConfiguration?.destinations ?? [{cloudWatchLogsLogGroup: {}}]

  return logDestinations.cloudWatchLogsLogGroup?.logGroupArn ?? ''
}

export const parseArn = (
  arn: string
): {
  partition: string
  service: string
  region: string
  accountId: string
  resourceType: string
  resourceName: string
} => {
  const matched = arn.split(':')

  return {
    partition: matched[1],
    service: matched[2],
    region: matched[3],
    accountId: matched[4],
    resourceType: matched[5],
    resourceName: matched[6],
  }
}
