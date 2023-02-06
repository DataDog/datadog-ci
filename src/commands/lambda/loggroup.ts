import {CloudWatchLogs} from 'aws-sdk'
import {DescribeSubscriptionFiltersRequest} from 'aws-sdk/clients/cloudwatchlogs'

import {SUBSCRIPTION_FILTER_NAME} from './constants'
import {LogGroupConfiguration} from './interfaces'

export enum SubscriptionState {
  Empty,
  CorrectDestination,
  WrongDestinationOwned,
  WrongDestinationUnowned,
}

const MAX_LOG_GROUP_SUBSCRIPTIONS = 2

export const applyLogGroupConfig = async (logs: CloudWatchLogs, config: LogGroupConfiguration) => {
  const {createLogGroupRequest, deleteSubscriptionFilterRequest, subscriptionFilterRequest} = config
  if (createLogGroupRequest !== undefined) {
    await logs.createLogGroup(createLogGroupRequest).promise()
  }
  if (deleteSubscriptionFilterRequest !== undefined) {
    await logs.deleteSubscriptionFilter(deleteSubscriptionFilterRequest).promise()
  }
  if (subscriptionFilterRequest !== undefined) {
    await logs.putSubscriptionFilter(subscriptionFilterRequest).promise()
  }
}

export const calculateLogGroupUpdateRequest = async (
  logs: CloudWatchLogs,
  logGroupName: string,
  forwarderARN: string
) => {
  const config: LogGroupConfiguration = {
    logGroupName,
    subscriptionFilterRequest: {
      destinationArn: forwarderARN,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: '',
      logGroupName,
    },
  }

  const logGroupPresent = await hasLogGroup(logs, logGroupName)

  let subscriptionState = SubscriptionState.Empty
  if (logGroupPresent) {
    subscriptionState = await getSubscriptionFilterState(logs, logGroupName, forwarderARN)
  } else {
    config.createLogGroupRequest = {
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
  logs: CloudWatchLogs,
  logGroupName: string,
  forwarderARN: string
) => {
  const config: LogGroupConfiguration = {
    logGroupName,
  }

  const subscriptionFilters = await getSubscriptionFilters(logs, logGroupName)
  const subscriptionToRemove = subscriptionFilters?.find(
    (subscription) =>
      subscription.destinationArn === forwarderARN || subscription.filterName === SUBSCRIPTION_FILTER_NAME
  )

  if (subscriptionToRemove) {
    config.deleteSubscriptionFilterRequest = {
      filterName: subscriptionToRemove.filterName!,
      logGroupName,
    }
  }

  return config
}

export const hasLogGroup = async (logs: CloudWatchLogs, logGroupName: string): Promise<boolean> => {
  const args = {
    logGroupNamePrefix: logGroupName,
  }
  const result = await logs.describeLogGroups(args).promise()
  const {logGroups} = result
  if (logGroups === undefined || logGroups.length === 0) {
    return false
  }

  return logGroups.find((lg) => lg.logGroupName === logGroupName) !== undefined
}

export const getSubscriptionFilterState = async (logs: CloudWatchLogs, logGroupName: string, forwarderARN: string) => {
  const subscriptionFilters = await getSubscriptionFilters(logs, logGroupName)
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

export const getSubscriptionFilters = async (logs: CloudWatchLogs, logGroupName: string) => {
  const subscriptionFiltersRequest: DescribeSubscriptionFiltersRequest = {
    logGroupName,
  }

  const {subscriptionFilters} = await logs.describeSubscriptionFilters(subscriptionFiltersRequest).promise()

  return subscriptionFilters
}
