import {ConfiguredRetryStrategy} from '@smithy/util-retry'

export const AWS_SHARED_CREDENTIALS_FILE_ENV_VAR = 'AWS_SHARED_CREDENTIALS_FILE'

/**
 * Region environment variables, in the order the AWS SDKs and CLI consult them.
 */
export const AWS_REGION_ENV_VAR = 'AWS_REGION'
export const AWS_DEFAULT_REGION_ENV_VAR = 'AWS_DEFAULT_REGION'
export const AWS_REGION_ENV_VARS = [AWS_REGION_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR]

export const LAUNCH_TYPE_FARGATE = 'FARGATE'

/**
 * Fargate tasks only support the `awsvpc` network mode, which puts every container in the task into
 * a single network namespace. That is what makes `127.0.0.1` a valid way for an application
 * container to reach the Agent sidecar.
 */
export const AWSVPC_NETWORK_MODE = 'awsvpc'

// Agent sidecar defaults
export const AGENT_CONTAINER_NAME = 'datadog-agent'
export const DEFAULT_AGENT_IMAGE = 'public.ecr.aws/datadog/agent:latest'

/**
 * The Agent's own health probe. Shipping it means application containers can gate their startup on
 * the Agent being ready through a `dependsOn` HEALTHY condition.
 */
export const AGENT_HEALTH_CHECK_COMMAND = ['CMD-SHELL', '/probe.sh']
export const AGENT_HEALTH_CHECK_INTERVAL = 15
export const AGENT_HEALTH_CHECK_TIMEOUT = 5
export const AGENT_HEALTH_CHECK_RETRIES = 3
export const AGENT_HEALTH_CHECK_START_PERIOD = 60

/**
 * The only log driver whose configuration can be shared with the Agent sidecar as-is. Other
 * drivers, `awsfirelens` in particular, route through a container that may not be configured to
 * accept the Agent's logs.
 */
export const AWSLOGS_LOG_DRIVER = 'awslogs'

// Datadog environment variables not already declared in helpers/serverless/constants.ts
export const ECS_FARGATE_ENV_VAR = 'ECS_FARGATE'
export const DD_APM_ENABLED_ENV_VAR = 'DD_APM_ENABLED'
export const DD_USE_DOGSTATSD_ENV_VAR = 'DD_USE_DOGSTATSD'
export const DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR = 'DD_ECS_TASK_COLLECTION_ENABLED'

/**
 * Fields `DescribeTaskDefinition` returns that `RegisterTaskDefinition` rejects. They have to be
 * dropped before a described task definition can be registered as a new revision.
 */
export const READ_ONLY_TASK_DEFINITION_FIELDS = [
  'taskDefinitionArn',
  'revision',
  'status',
  'requiresAttributes',
  'compatibilities',
  'registeredAt',
  'registeredBy',
  'deregisteredAt',
] as const

// Configures max number of attempts and exponential backoff function for AWS requests
// First retry is attempt 1
export const EXPONENTIAL_BACKOFF_RETRY_STRATEGY = new ConfiguredRetryStrategy(
  4,
  (attempt: number) => 1000 * 2 ** (attempt - 1)
)
