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

/**
 * ECS spells the Windows operating system families `WINDOWS_SERVER_2019_CORE`,
 * `WINDOWS_SERVER_2022_FULL`, and so on, so they are matched by prefix. Anything else, `LINUX` and
 * declaring no family at all included, runs Linux.
 */
export const WINDOWS_OS_FAMILY_PREFIX = 'WINDOWS_SERVER'

// Agent sidecar defaults
export const AGENT_CONTAINER_NAME = 'datadog-agent'

/**
 * The tag suffix for the Windows build of the Agent image. Datadog publishes it as a manifest list
 * covering Windows Server 2019, 2022, and 2025, so ECS pulls the one matching the task's platform.
 */
export const WINDOWS_AGENT_IMAGE_SUFFIX = '-servercore'

/**
 * The working directory the Agent requires on Windows, which its image does not set itself.
 */
export const WINDOWS_WORKING_DIRECTORY = 'C:\\'

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
 *
 * Linux only: `/probe.sh` is a shell script shipped in the Linux image, and the Windows image has
 * no equivalent on its `PATH`, so Windows tasks get no health check at all.
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
