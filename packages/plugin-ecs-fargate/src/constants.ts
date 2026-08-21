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
 * a single network namespace
 */
export const AWSVPC_NETWORK_MODE = 'awsvpc'

// Agent sidecar defaults
export const AGENT_CONTAINER_NAME = 'datadog-agent'

/**
 * The task definition tag keys for the unified service tags, which name the same three concepts as
 * the `DD_SERVICE`, `DD_ENV`, and `DD_VERSION` environment variables the containers run with.
 */
export const SERVICE_TAG_KEY = 'service'
export const ENVIRONMENT_TAG_KEY = 'env'
export const VERSION_TAG_KEY = 'version'

/**
 * Docker labels the Agent reads to attach the unified service tags to the metrics it collects about
 * a container. The `DD_SERVICE` family of environment variables covers what the tracer inside the
 * container sends; these cover what the Agent observes from the outside.
 */
export const DOCKER_LABEL_SERVICE = 'com.datadoghq.tags.service'
export const DOCKER_LABEL_ENV = 'com.datadoghq.tags.env'
export const DOCKER_LABEL_VERSION = 'com.datadoghq.tags.version'

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
export const DD_DOGSTATSD_ORIGIN_DETECTION_ENV_VAR = 'DD_DOGSTATSD_ORIGIN_DETECTION'
export const DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT_ENV_VAR = 'DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT'
export const DD_DOGSTATSD_TAG_CARDINALITY_ENV_VAR = 'DD_DOGSTATSD_TAG_CARDINALITY'
export const DD_TRACE_AGENT_URL_ENV_VAR = 'DD_TRACE_AGENT_URL'
export const DD_DOGSTATSD_URL_ENV_VAR = 'DD_DOGSTATSD_URL'
export const DD_AGENT_HOST_ENV_VAR = 'DD_AGENT_HOST'

/**
 * The volume carrying the Agent's APM and DogStatsD sockets. The tracers write to it and the Agent
 * reads from it, which is why both sides mount it at the path the Agent's image already listens on.
 */
export const AGENT_SOCKET_VOLUME_NAME = 'dd-sockets'
export const AGENT_SOCKET_MOUNT_PATH = '/var/run/datadog'
export const APM_SOCKET_URL = `unix://${AGENT_SOCKET_MOUNT_PATH}/apm.socket`
export const DOGSTATSD_SOCKET_URL = `unix://${AGENT_SOCKET_MOUNT_PATH}/dsd.socket`

/**
 * Where the tracers send telemetry when the socket is turned off. Every container in a Fargate task
 * shares one network namespace, so the Agent is on the task's own loopback address.
 */
export const AGENT_LOOPBACK_HOST = '127.0.0.1'

/**
 * The tag cardinality custom metrics are submitted with: enough to tell one task apart from another.
 */
export const DOGSTATSD_ORCHESTRATOR_CARDINALITY = 'orchestrator'

/**
 * The task role permissions the Agent needs to collect ECS task metadata.
 */
export const ECS_TASK_COLLECTION_ACTIONS = [
  'ecs:ListClusters',
  'ecs:ListContainerInstances',
  'ecs:DescribeContainerInstances',
]

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
