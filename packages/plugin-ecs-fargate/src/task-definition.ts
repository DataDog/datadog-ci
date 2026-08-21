import type {
  ContainerDefinition,
  KeyValuePair,
  LogConfiguration,
  RegisterTaskDefinitionCommandInput,
  Secret,
  Tag,
  TaskDefinition,
} from '@aws-sdk/client-ecs'

import {sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {API_KEY_ENV_VAR, SITE_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'
import {removeUndefinedValues} from '@datadog/datadog-ci-base/helpers/utils'

import {
  AGENT_CONTAINER_NAME,
  AGENT_HEALTH_CHECK_COMMAND,
  AGENT_HEALTH_CHECK_INTERVAL,
  AGENT_HEALTH_CHECK_RETRIES,
  AGENT_HEALTH_CHECK_START_PERIOD,
  AGENT_HEALTH_CHECK_TIMEOUT,
  AWSLOGS_LOG_DRIVER,
  AWSVPC_NETWORK_MODE,
  DD_APM_ENABLED_ENV_VAR,
  DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR,
  DD_USE_DOGSTATSD_ENV_VAR,
  ECS_FARGATE_ENV_VAR,
  LAUNCH_TYPE_FARGATE,
  READ_ONLY_TASK_DEFINITION_FIELDS,
} from './constants'

/**
 * What the user asked for, resolved into the decisions the transform needs.
 */
export type InstrumentSettings = {
  agentImage: string
  site: string
  /** The API key, when it is written to the task definition in plain text. */
  apiKey?: string
  /** The Secrets Manager ARN holding the API key. Preferred: it keeps the key off the task definition. */
  apiKeySecretArn?: string
}

export type InstrumentResult = {
  taskDefinition: RegisterTaskDefinitionCommandInput
  warnings: string[]
}

/**
 * Builds the environment the Agent sidecar runs with.
 */
export const getAgentEnvVars = (settings: InstrumentSettings): Record<string, string> => {
  const envVars: Record<string, string> = {
    [ECS_FARGATE_ENV_VAR]: 'true',
    [SITE_ENV_VAR]: settings.site,
    [DD_APM_ENABLED_ENV_VAR]: 'true',
    [DD_USE_DOGSTATSD_ENV_VAR]: 'true',
    [DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR]: 'true',
  }

  if (settings.apiKey) {
    envVars[API_KEY_ENV_VAR] = settings.apiKey
  }

  return envVars
}

/**
 * Merges the managed environment variables into the ones already on the container, by name.
 *
 * Existing variables keep their position so that re-running produces an identical array rather than
 * a reordered one that would show up as a diff.
 */
const toEnvironment = (managed: Record<string, string>, existing?: KeyValuePair[]): KeyValuePair[] => {
  const merged = new Map<string, string | undefined>()
  for (const {name, value} of existing ?? []) {
    if (name !== undefined) {
      merged.set(name, value)
    }
  }
  for (const [name, value] of Object.entries(managed)) {
    merged.set(name, value)
  }

  return [...merged].map(([name, value]) => ({name, value}))
}

export type AgentContainerResult = {
  container: ContainerDefinition
  warnings: string[]
}

/**
 * Builds the Datadog Agent sidecar container definition.
 *
 * `existing` is the Agent container already present on the task definition, if any. Environment
 * variables and secrets are merged by name, so additions the user made by hand survive
 * re-instrumentation and a second run produces an identical container rather than accumulating
 * duplicates. Where the command has to take ownership of a field the user had already set, it says
 * so through a warning rather than changing it silently.
 *
 * No port mappings are declared. Every container in an `awsvpc` task shares a network namespace, so
 * the Agent is already reachable on `127.0.0.1` without one; a mapping would only publish DogStatsD
 * and the trace intake on the task's network interface.
 */
export const buildAgentContainer = (
  settings: InstrumentSettings,
  existing?: ContainerDefinition,
  logConfiguration?: LogConfiguration
): AgentContainerResult => {
  const warnings: string[] = []

  // The API key lives either in `secrets` or in `environment`, never both, so switching between the
  // two does not leave the old one behind. The field is only written when there is something to put
  // in it, so a task definition that never had secrets does not gain an empty list.
  const inheritedSecrets = (existing?.secrets ?? []).filter((secret) => secret.name !== API_KEY_ENV_VAR)
  let secrets: Secret[] | undefined
  if (settings.apiKeySecretArn) {
    secrets = [...inheritedSecrets, {name: API_KEY_ENV_VAR, valueFrom: settings.apiKeySecretArn}]
  } else if (existing?.secrets !== undefined) {
    secrets = inheritedSecrets
  }

  const inheritedEnvironment = settings.apiKeySecretArn
    ? (existing?.environment ?? []).filter((envVar) => envVar.name !== API_KEY_ENV_VAR)
    : existing?.environment

  if (existing?.essential === true) {
    warnings.push(
      `Marking the ${AGENT_CONTAINER_NAME} container non-essential, overriding the task definition: a crashed Agent should cost telemetry, not availability.`
    )
  }

  const healthCheck = {
    command: [...AGENT_HEALTH_CHECK_COMMAND],
    interval: AGENT_HEALTH_CHECK_INTERVAL,
    timeout: AGENT_HEALTH_CHECK_TIMEOUT,
    retries: AGENT_HEALTH_CHECK_RETRIES,
    startPeriod: AGENT_HEALTH_CHECK_START_PERIOD,
  }
  if (existing?.healthCheck && !sortedEqual(existing.healthCheck, healthCheck)) {
    warnings.push(`Replacing the health check on the ${AGENT_CONTAINER_NAME} container with the Agent's own probe.`)
  }

  const container = removeUndefinedValues({
    ...existing,
    name: AGENT_CONTAINER_NAME,
    image: settings.agentImage,
    // The Agent must not be able to take the task down: a crashed Agent should cost telemetry, not
    // availability.
    essential: false,
    environment: toEnvironment(getAgentEnvVars(settings), inheritedEnvironment),
    secrets,
    healthCheck,
    // Without one, a Fargate container's output goes nowhere, which would leave an Agent that
    // cannot pull its image or reach Datadog impossible to diagnose.
    logConfiguration: existing?.logConfiguration ?? logConfiguration,
  })

  return {container, warnings}
}

/**
 * The log configuration to give the Agent sidecar, borrowed from an application container.
 *
 * Only `awslogs` is reused: it names a log group the execution role can already write to, and adds
 * the container name to the stream on its own, so it needs no adjusting. Other drivers route
 * through a container that may not accept the Agent's logs.
 */
const borrowedLogConfiguration = (containers: ContainerDefinition[]): LogConfiguration | undefined =>
  containers.find(
    (container) =>
      container.name !== AGENT_CONTAINER_NAME && container.logConfiguration?.logDriver === AWSLOGS_LOG_DRIVER
  )?.logConfiguration

/**
 * Stamps the revision with the version of the CLI that produced it, replacing other possibly existing values
 */
const withCliVersionTag = (tags: Tag[]): Tag[] => [
  ...tags.filter((tag) => tag.key !== SERVERLESS_CLI_VERSION_TAG_NAME),
  {key: SERVERLESS_CLI_VERSION_TAG_NAME, value: SERVERLESS_CLI_VERSION_TAG_VALUE},
]

/**
 * Rewrites a Fargate task definition to run the Datadog Agent as a sidecar alongside the
 * application containers, which are left untouched.
 *
 * The Agent container is keyed by name, so instrumenting an already instrumented task definition
 * produces an identical result and does not burn a revision.
 */
export const instrumentTaskDefinition = (
  taskDefinition: TaskDefinition,
  settings: InstrumentSettings,
  tags: Tag[] = []
): InstrumentResult => {
  const family = taskDefinition.family

  const compatibilities = (taskDefinition.requiresCompatibilities ?? []).map((compatibility) =>
    compatibility.toUpperCase()
  )
  if (compatibilities.length > 0 && !compatibilities.includes(LAUNCH_TYPE_FARGATE)) {
    throw Error(
      `Task definition ${family} does not declare ${LAUNCH_TYPE_FARGATE} in requiresCompatibilities, so it cannot run on Fargate.`
    )
  }

  if (taskDefinition.networkMode !== AWSVPC_NETWORK_MODE) {
    throw Error(
      `Task definition ${family} uses the ${
        taskDefinition.networkMode ?? 'default'
      } network mode. Fargate requires ${AWSVPC_NETWORK_MODE}.`
    )
  }

  const containers = taskDefinition.containerDefinitions ?? []
  const existingAgent = containers.find((container) => container.name === AGENT_CONTAINER_NAME)
  const {container: agentContainer, warnings} = buildAgentContainer(
    settings,
    existingAgent,
    borrowedLogConfiguration(containers)
  )

  if (!agentContainer.logConfiguration) {
    warnings.push(
      `The ${AGENT_CONTAINER_NAME} container has no logConfiguration, so its own logs will not be collected and a failing Agent will be hard to diagnose. Add one to the task definition.`
    )
  }

  const containerDefinitions = containers.map((container) =>
    container.name === AGENT_CONTAINER_NAME ? agentContainer : container
  )
  if (!existingAgent) {
    containerDefinitions.push(agentContainer)
  }

  return {
    taskDefinition: {
      ...stripReadOnlyFields(taskDefinition),
      containerDefinitions,
      tags: withCliVersionTag(tags),
    },
    warnings,
  }
}

const withoutCliVersionTag = (input: RegisterTaskDefinitionCommandInput): RegisterTaskDefinitionCommandInput => ({
  ...input,
  tags: (input.tags ?? []).filter((tag) => tag.key !== SERVERLESS_CLI_VERSION_TAG_NAME),
})

/**
 * Whether the task definition already matches what instrumentation would register.
 *
 * The CLI version tag is left out of the comparison, so upgrading datadog-ci does not on its own
 * produce a revision that services then have to be redeployed onto. The tag still rides along on
 * revisions registered for other reasons, recording the version that produced each one.
 */
export const isUpToDate = (
  original: RegisterTaskDefinitionCommandInput,
  updated: RegisterTaskDefinitionCommandInput
): boolean => sortedEqual(withoutCliVersionTag(original), withoutCliVersionTag(updated))

/**
 * The read-only fields, narrowed to keys of `TaskDefinition` so a name that stops existing in a
 * future SDK version fails to compile rather than silently stripping nothing.
 */
const READ_ONLY_FIELDS: ReadonlySet<keyof TaskDefinition> = new Set<keyof TaskDefinition>(
  READ_ONLY_TASK_DEFINITION_FIELDS
)

/**
 * Drops the fields `DescribeTaskDefinition` returns but `RegisterTaskDefinition` rejects, so a
 * described task definition can be registered as a new revision.
 *
 * Driven off `READ_ONLY_TASK_DEFINITION_FIELDS` rather than a hand-written destructure, so the list
 * has one definition. `family` and `containerDefinitions` are restated because the register input
 * requires the keys to be present even when their values are undefined.
 */
export const stripReadOnlyFields = (taskDefinition: TaskDefinition): RegisterTaskDefinitionCommandInput => {
  const registerable = Object.fromEntries(
    Object.entries(taskDefinition).filter(([field]) => !READ_ONLY_FIELDS.has(field as keyof TaskDefinition))
  )

  return {
    ...registerable,
    family: taskDefinition.family,
    containerDefinitions: taskDefinition.containerDefinitions,
  }
}
