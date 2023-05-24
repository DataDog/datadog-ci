import {DescribeStateMachineCommandOutput} from '@aws-sdk/client-sfn'
import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'

import {DD_CI_IDENTIFING_STRING} from './constants'

export const displayChanges = (
  stepFunctionArn: string,
  context: BaseContext,
  commandName: string,
  dryRun: boolean,
  params: any,
  previousParams?: any
): void => {
  context.stdout.write(`${'='.repeat(50)}`)
  context.stdout.write(`\n${dryRun ? '\n[Dry Run] Planning for' : 'Will apply'} the following change:\n`)
  context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
  if (previousParams !== undefined) {
    context.stdout.write(
      `\n${commandName}:\nFrom:\n${JSON.stringify(diff(params, previousParams), undefined, 2)}\nTo:\n${JSON.stringify(
        diff(previousParams, params),
        undefined,
        2
      )}\n`
    )
  } else {
    context.stdout.write(`\n${commandName}: \n${JSON.stringify(params, undefined, 2)}\n`)
  }
}

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

export const buildSubscriptionFilterName = (stepFunctionName: string): string => {
  return `${stepFunctionName}-${DD_CI_IDENTIFING_STRING}`
}

export const isValidArn = (str: string): boolean => {
  const arnFields = str.split(':')

  return arnFields.length >= 7 && arnFields[0] === 'arn'
}

export const getStepFunctionLogGroupArn = (stepFunction: DescribeStateMachineCommandOutput): string | undefined => {
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
export const buildLogAccessPolicyName = (stepFunction: DescribeStateMachineCommandOutput): string => {
  return `LogsDeliveryAccessPolicy-${stepFunction.name}`
}
