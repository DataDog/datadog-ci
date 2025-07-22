import {
  CloudWatchLogsClient,
  CreateLogGroupCommandInput,
  DeleteSubscriptionFilterCommandInput,
  PutSubscriptionFilterCommandInput,
} from '@aws-sdk/client-cloudwatch-logs'
import {
  FunctionConfiguration as LFunctionConfiguration,
  LambdaClient,
  TagResourceCommandInput,
  UpdateFunctionConfigurationCommandInput,
  UntagResourceCommandInput,
} from '@aws-sdk/client-lambda'

/**
 * Configuration comprised by a Lambda Function ARN,
 * its configuration from AWS, its library layer ARN,
 * the changes in logs, tags, and the update request.
 */
export interface FunctionConfiguration {
  functionARN: string
  lambdaConfig: LFunctionConfiguration
  logGroupConfiguration?: LogGroupConfiguration
  tagConfiguration?: TagConfiguration
  updateFunctionConfigurationCommandInput?: UpdateFunctionConfigurationCommandInput
}

export interface InstrumentedConfigurationGroup {
  cloudWatchLogsClient: CloudWatchLogsClient
  configs: FunctionConfiguration[]
  lambdaClient: LambdaClient
  region: string
}

/**
 * Basic settings to use in every specified
 * lambda to be instrumented.
 */
export interface InstrumentationSettings extends InstrumentationTags {
  apmFlushDeadline?: string
  appsecEnabled?: boolean
  captureLambdaPayload?: boolean
  extensionVersion?: number
  flushMetricsToLogs: boolean
  forwarderARN?: string
  interactive?: boolean
  layerAWSAccount?: string
  layerVersion?: number
  loggingEnabled?: boolean
  logLevel?: string
  mergeXrayTraces: boolean
  tracingEnabled: boolean
  llmobsEnabled?: boolean
  llmobsMlApp?: string
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
  createLogGroupCommandInput?: CreateLogGroupCommandInput
  deleteSubscriptionFilterCommandInput?: DeleteSubscriptionFilterCommandInput
  logGroupName: string
  putSubscriptionFilterCommandInput?: PutSubscriptionFilterCommandInput
}

export interface TagConfiguration {
  tagResourceCommandInput?: TagResourceCommandInput
  untagResourceCommandInput?: UntagResourceCommandInput
}
