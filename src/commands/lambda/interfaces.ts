import {CloudWatchLogs, Lambda} from 'aws-sdk'

/**
 * Configuration options provided by the user through
 * the CLI in order to instrument properly.
 */
export interface LambdaConfigOptions {
  environment?: string
  extensionVersion?: string
  extraTags?: string
  flushMetricsToLogs?: string
  forwarder?: string
  functions: string[]
  layerAWSAccount?: string
  layerVersion?: string
  logLevel?: string
  mergeXrayTraces?: string
  region?: string
  service?: string
  tracing?: string
  version?: string
}

/**
 * Configuration comprised by a Lambda Function ARN,
 * its configuration from AWS, its library layer ARN,
 * the changes in logs, tags, and the update request.
 */
export interface FunctionConfiguration {
  functionARN: string
  lambdaConfig: Lambda.FunctionConfiguration
  logGroupConfiguration?: LogGroupConfiguration
  tagConfiguration?: TagConfiguration
  updateRequest?: Lambda.UpdateFunctionConfigurationRequest
}

/**
 * Basic settings to use in every specified
 * lambda to be instrumented.
 */
export interface InstrumentationSettings extends InstrumentationTags {
  extensionVersion?: number
  flushMetricsToLogs: boolean
  forwarderARN?: string
  layerAWSAccount?: string
  layerVersion?: number
  logLevel?: string
  mergeXrayTraces: boolean
  tracingEnabled: boolean
}

/**
 * Interface for Unified Service Tagging.
 *
 * See more at: https://docs.datadoghq.com/getting_started/tagging/unified_service_tagging/?tab=kubernetes#overview
 */
interface InstrumentationTags {
  environment?: string
  extraTags?: string
  service?: string
  version?: string
}

export interface LogGroupConfiguration {
  createLogGroupRequest?: CloudWatchLogs.CreateLogGroupRequest
  deleteSubscriptionFilterRequest?: CloudWatchLogs.DeleteSubscriptionFilterRequest
  logGroupName: string
  subscriptionFilterRequest?: CloudWatchLogs.PutSubscriptionFilterRequest
}

export interface TagConfiguration {
  tagResourceRequest?: Lambda.TagResourceRequest
  untagResourceRequest?: Lambda.UntagResourceRequest
}
