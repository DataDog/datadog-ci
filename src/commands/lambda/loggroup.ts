import type {
  CloudWatchLogsClient,
  CreateLogGroupCommandInput,
  DeleteSubscriptionFilterCommandInput,
  DescribeLogGroupsCommandInput,
  DescribeSubscriptionFiltersCommandInput,
  PutSubscriptionFilterCommandInput,
} from '@aws-sdk/client-cloudwatch-logs'

import {SUBSCRIPTION_FILTER_NAME} from './constants'
import {LogGroupConfiguration} from './interfaces'

export enum SubscriptionState {
  Empty,
  CorrectDestination,
  WrongDestinationOwned,
  WrongDestinationUnowned,
}

const MAX_LOG_GROUP_SUBSCRIPTIONS = 2

export const applyLogGroupConfig = async (client: CloudWatchLogsClient, config: LogGroupConfiguration) => {
  const {createLogGroupCommandInput, deleteSubscriptionFilterCommandInput, putSubscriptionFilterCommandInput} = config
  if (createLogGroupCommandInput !== undefined) {
    await createLogGroup(client, createLogGroupCommandInput)
  }
  if (deleteSubscriptionFilterCommandInput !== undefined) {
    await deleteSubscriptionFilter(client, deleteSubscriptionFilterCommandInput)
  }
  if (putSubscriptionFilterCommandInput !== undefined) {
    await putSubscriptionFilter(client, putSubscriptionFilterCommandInput)
  }
}

export const createLogGroup = async (client: CloudWatchLogsClient, input: CreateLogGroupCommandInput) => {
  const {CreateLogGroupCommand} = await import('@aws-sdk/client-cloudwatch-logs')

  const command = new CreateLogGroupCommand(input)
  await client.send(command)
}

export const deleteSubscriptionFilter = async (
  client: CloudWatchLogsClient,
  input: DeleteSubscriptionFilterCommandInput
) => {
  const {DeleteSubscriptionFilterCommand} = await import('@aws-sdk/client-cloudwatch-logs')

  const command = new DeleteSubscriptionFilterCommand(input)
  await client.send(command)
}

export const putSubscriptionFilter = async (client: CloudWatchLogsClient, input: PutSubscriptionFilterCommandInput) => {
  const {PutSubscriptionFilterCommand} = await import('@aws-sdk/client-cloudwatch-logs')

  const command = new PutSubscriptionFilterCommand(input)
  await client.send(command)
}

export const calculateLogGroupUpdateRequest = async (
  client: CloudWatchLogsClient,
  logGroupName: string,
  forwarderARN: string
) => {
  const config: LogGroupConfiguration = {
    logGroupName,
    putSubscriptionFilterCommandInput: {
      destinationArn: forwarderARN,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: '',
      logGroupName,
    },
  }

  const logGroupPresent = await hasLogGroup(client, logGroupName)

  let subscriptionState = SubscriptionState.Empty
  if (logGroupPresent) {
    subscriptionState = await getSubscriptionFilterState(client, logGroupName, forwarderARN)
  } else {
    config.createLogGroupCommandInput = {
      logGroupName,
    }
  }

  if (subscriptionState === SubscriptionState.CorrectDestination) {
    // All up to date, nothing to be done
    return
  }
  if (subscriptionState === SubscriptionState.WrongDestinationUnowned) {
    // Can't update, don't own the subscription
    throw Error(
      `Maximum of ${MAX_LOG_GROUP_SUBSCRIPTIONS} subscription filters already exist on log group ${logGroupName}. Cannot add Datadog forwarder subscription.`
    )
  }

  return config
}

export const calculateLogGroupRemoveRequest = async (
  client: CloudWatchLogsClient,
  logGroupName: string,
  forwarderARN: string
) => {
  const config: LogGroupConfiguration = {
    logGroupName,
  }

  const subscriptionFilters = await getSubscriptionFilters(client, logGroupName)
  const subscriptionToRemove = subscriptionFilters?.find(
    (subscription) =>
      subscription.destinationArn === forwarderARN || subscription.filterName === SUBSCRIPTION_FILTER_NAME
  )

  if (subscriptionToRemove) {
    config.deleteSubscriptionFilterCommandInput = {
      filterName: subscriptionToRemove.filterName!,
      logGroupName,
    }
  }

  return config
}

export const hasLogGroup = async (client: CloudWatchLogsClient, logGroupName: string): Promise<boolean> => {
  const {DescribeLogGroupsCommand} = await import('@aws-sdk/client-cloudwatch-logs')

  const input: DescribeLogGroupsCommandInput = {
    logGroupNamePrefix: logGroupName,
  }

  const command = new DescribeLogGroupsCommand(input)
  const response = await client.send(command)
  const {logGroups} = response

  if (logGroups === undefined || logGroups.length === 0) {
    return false
  }

  return logGroups.find((lg) => lg.logGroupName === logGroupName) !== undefined
}

export const getSubscriptionFilterState = async (
  client: CloudWatchLogsClient,
  logGroupName: string,
  forwarderARN: string
) => {
  const subscriptionFilters = await getSubscriptionFilters(client, logGroupName)
  if (subscriptionFilters === undefined || subscriptionFilters.length === 0) {
    return SubscriptionState.Empty
  }
  if (subscriptionFilters.find((sf) => sf.destinationArn === forwarderARN) !== undefined) {
    return SubscriptionState.CorrectDestination
  }
  if (subscriptionFilters.find((sf) => sf.filterName === SUBSCRIPTION_FILTER_NAME)) {
    // Subscription filter was created by this CI tool
    return SubscriptionState.WrongDestinationOwned
  }

  // If a non-Datadog subscription already exists but we are still under the max
  // then we have an empty slot to add the Datadog subscription
  if (subscriptionFilters.length < MAX_LOG_GROUP_SUBSCRIPTIONS) {
    return SubscriptionState.Empty
  }

  return SubscriptionState.WrongDestinationUnowned
}

export const getSubscriptionFilters = async (client: CloudWatchLogsClient, logGroupName: string) => {
  const {DescribeSubscriptionFiltersCommand} = await import('@aws-sdk/client-cloudwatch-logs')

  const input: DescribeSubscriptionFiltersCommandInput = {
    logGroupName,
  }
  const command = new DescribeSubscriptionFiltersCommand(input)
  const response = await client.send(command)

  const {subscriptionFilters} = response

  return subscriptionFilters
}
