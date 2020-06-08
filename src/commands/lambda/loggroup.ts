import {CloudWatchLogs} from 'aws-sdk'
import {SUBSCRIPTION_FILTER_NAME} from './constants'

export interface LogGroupConfiguration {
  createLogGroupRequest?: CloudWatchLogs.CreateLogGroupRequest
  deleteSubscriptionFilterRequest?: CloudWatchLogs.DeleteSubscriptionFilterRequest
  logGroupName: string
  subscriptionFilterRequest: CloudWatchLogs.PutSubscriptionFilterRequest
}

export enum SubscriptionState {
  Empty,
  CorrectDestination,
  WrongDestinationOwned,
  WrongDestinationUnowned,
}

export const applyLogGroupConfig = async (logs: CloudWatchLogs, configuration: LogGroupConfiguration) => {
  const {createLogGroupRequest, deleteSubscriptionFilterRequest, subscriptionFilterRequest} = configuration
  if (createLogGroupRequest !== undefined) {
    await logs.createLogGroup(createLogGroupRequest).promise()
  }
  if (deleteSubscriptionFilterRequest !== undefined) {
    await logs.deleteSubscriptionFilter(deleteSubscriptionFilterRequest).promise()
  }
  await logs.putSubscriptionFilter(subscriptionFilterRequest).promise()
}

export const calculateLogGroupUpdateRequest = async (
  logs: CloudWatchLogs,
  logGroupName: string,
  forwarderArn: string
) => {
  const config: LogGroupConfiguration = {
    logGroupName,
    subscriptionFilterRequest: {
      destinationArn: forwarderArn,
      filterName: SUBSCRIPTION_FILTER_NAME,
      filterPattern: '',
      logGroupName,
    },
  }

  const logGroupPresent = await hasLogGroup(logs, logGroupName)

  let subscriptionState = SubscriptionState.Empty
  if (logGroupPresent) {
    subscriptionState = await getSubscriptionFilterState(logs, logGroupName, forwarderArn)
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
    throw Error(`Unknown subscription filter already on log group ${logGroupName}. Only one subscription is allowed.`)
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
export const getSubscriptionFilterState = async (logs: CloudWatchLogs, logGroupName: string, forwarderArn: string) => {
  const {subscriptionFilters} = await logs.describeSubscriptionFilters({logGroupName}).promise()
  if (subscriptionFilters === undefined || subscriptionFilters.length === 0) {
    return SubscriptionState.Empty
  }
  if (subscriptionFilters.find((sf) => sf.destinationArn === forwarderArn) !== undefined) {
    return SubscriptionState.CorrectDestination
  }
  if (subscriptionFilters.find((sf) => sf.filterName === SUBSCRIPTION_FILTER_NAME)) {
    // Subscription filter was created by this CI tool
    return SubscriptionState.WrongDestinationOwned
  }

  return SubscriptionState.WrongDestinationUnowned
}
