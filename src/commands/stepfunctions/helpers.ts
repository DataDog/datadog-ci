import {StepFunctions} from 'aws-sdk'
import {BaseContext} from 'clipanion'
import {diff} from 'deep-object-diff'
import {DescribeStateMachineCommandOutput} from "@aws-sdk/client-sfn";

export const displayChanges = (
  stepFunctionArn: string,
  context: BaseContext,
  commandName: string,
  dryRun: boolean,
  params: any,
  previousParams?: any
): void => {
  context.stdout.write(`\n${dryRun ? '[Dry Run] ' : ''}Will apply the following changes:\n`)
  context.stdout.write(`\n${'='.repeat(30)}`)
  context.stdout.write(`\nChanges for ${stepFunctionArn}\n`)
  if (previousParams !== undefined) {
    context.stdout.write(
      `\n${commandName} ->\n${JSON.stringify(diff(params, previousParams), undefined, 2)}\n--->\n${JSON.stringify(
        diff(previousParams, params),
        undefined,
        2
      )}\n`
    )
  } else {
    context.stdout.write(`${commandName} ->\n${JSON.stringify(params, undefined, 2)}\n`)
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

export const DD_CI_IDENTIFING_STRING = 'DdCiLogGroupSubscription'
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