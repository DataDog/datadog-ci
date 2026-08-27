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
import {
  AGENT_IMAGE,
  API_KEY_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  SITE_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
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
  DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT_ENV_VAR,
  DD_DOGSTATSD_ORIGIN_DETECTION_ENV_VAR,
  DD_DOGSTATSD_TAG_CARDINALITY_ENV_VAR,
  DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR,
  DD_USE_DOGSTATSD_ENV_VAR,
  DOGSTATSD_ORCHESTRATOR_CARDINALITY,
  ECS_FARGATE_ENV_VAR,
  ECS_TASK_COLLECTION_ACTIONS,
  LAUNCH_TYPE_FARGATE,
  READ_ONLY_TASK_DEFINITION_FIELDS,
} from './constants'

/**
 * What the user asked for, resolved into the decisions the transform needs.
 */
export type InstrumentSettings = {
  /**
   * The Agent image to run. Absent leaves the choice to the transform, which picks the default
   * build.
   */
  agentImage?: string
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
 * Values to write to a container, split by how strongly the command owns them.
 */
type ManagedValues = {
  /** Owned by the command: these replace what the task definition had. */
  managed: Record<string, string>
  /** Suggested by the command: a value already on the container wins. */
  defaults: Record<string, string>
}

/**
 * Merges the values the command writes into the ones already on the container, by name: defaults
 * fill in what is missing, managed values replace what is there.
 *
 * Existing entries keep their position, so that re-running produces an identical result rather than
 * a reordered one that would show up as a diff.
 */
const mergeManaged = <T>(
  {managed, defaults}: ManagedValues,
  existing: Iterable<readonly [string, T]>
): Map<string, string | T> => {
  const merged = new Map<string, string | T>(existing)
  for (const [name, value] of Object.entries(defaults)) {
    if (!merged.has(name)) {
      merged.set(name, value)
    }
  }
  for (const [name, value] of Object.entries(managed)) {
    merged.set(name, value)
  }

  return merged
}

/**
 * Builds the environment the Agent sidecar runs with.
 */
const getAgentEnvVars = (settings: InstrumentSettings): ManagedValues => ({
  managed: {
    [ECS_FARGATE_ENV_VAR]: 'true',
    [SITE_ENV_VAR]: settings.site,
    // The Agent's own trace intake, which is a separate switch from the tracers' `DD_TRACE_ENABLED`.
    [DD_APM_ENABLED_ENV_VAR]: 'true',
    [DD_USE_DOGSTATSD_ENV_VAR]: 'true',
    [DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR]: 'true',
    ...(settings.apiKey ? {[API_KEY_ENV_VAR]: settings.apiKey} : {}),
  },
  defaults: {
    [DD_DOGSTATSD_ORIGIN_DETECTION_ENV_VAR]: 'true',
    [DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT_ENV_VAR]: 'true',
    [DD_DOGSTATSD_TAG_CARDINALITY_ENV_VAR]: DOGSTATSD_ORCHESTRATOR_CARDINALITY,
  },
})

/**
 * Builds the environment the application containers run with: the switches the tracer libraries
 * read.
 *
 * Tracing and log injection are defaults rather than managed values, so a task definition that has
 * already made a choice about either keeps it.
 */
const getAppContainerEnvVars = (): ManagedValues => ({
  managed: {},
  defaults: {
    [DD_TRACE_ENABLED_ENV_VAR]: 'true',
    [LOGS_INJECTION_ENV_VAR]: 'true',
  },
})

/**
 * The environment to give a container: what the command writes, merged into what the container
 * already declares.
 */
const toEnvironment = (values: ManagedValues, existing?: KeyValuePair[]): KeyValuePair[] => {
  const declared: [string, string | undefined][] = []
  for (const {name, value} of existing ?? []) {
    if (name !== undefined) {
      declared.push([name, value])
    }
  }

  return [...mergeManaged(values, declared)].map(([name, value]) => ({name, value}))
}

export type AgentContainerResult = {
  container: ContainerDefinition
  warnings: string[]
}

/**
 * What the Agent sidecar is built from.
 */
type AgentContainerContext = {
  settings: InstrumentSettings
  /** The Agent container already on the task definition, if any. */
  existing?: ContainerDefinition
  /** A log configuration borrowed from an application container, when the Agent has none. */
  logConfiguration?: LogConfiguration
}

/**
 * Builds the Datadog Agent sidecar container definition, merging environment variables and secrets
 * into those of `existing`, the Agent container already on the task definition. Fields it must own
 * but that the user had already set are reported as warnings rather than changed silently.
 */
const buildAgentContainer = ({settings, existing, logConfiguration}: AgentContainerContext): AgentContainerResult => {
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

  if (existing !== undefined && existing.essential !== false) {
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
    image: settings.agentImage ?? AGENT_IMAGE,
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
 * The log configuration to give the Agent sidecar: the first `awslogs` one found on an application
 * container, whose log group the execution role can already write to.
 */
const borrowedLogConfiguration = (containers: ContainerDefinition[]): LogConfiguration | undefined =>
  containers.find(
    (container) =>
      container.name !== AGENT_CONTAINER_NAME && container.logConfiguration?.logDriver === AWSLOGS_LOG_DRIVER
  )?.logConfiguration

/**
 * The tags the revision carries: the version of the CLI that produced it, replacing whatever the
 * task definition had.
 */
const instrumentationTags = (tags: Tag[]): Tag[] => [
  ...tags.filter((tag) => tag.key !== SERVERLESS_CLI_VERSION_TAG_NAME),
  {key: SERVERLESS_CLI_VERSION_TAG_NAME, value: SERVERLESS_CLI_VERSION_TAG_VALUE},
]

/**
 * Rewrites a Fargate task definition to run the Datadog Agent as a sidecar alongside the
 * application containers, which are given the environment their tracers read.
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

  // ECS resolves secrets through the task's execution role, so a reference without a role in place
  // would register a revision whose tasks cannot start. Registering it would be worse than doing
  // nothing: with --ecs-service it replaces healthy tasks with tasks that fail at startup.
  if (settings.apiKeySecretArn && !taskDefinition.executionRoleArn) {
    throw Error(
      `Task definition ${family} has no executionRoleArn, which ECS needs to read ${settings.apiKeySecretArn}, so tasks started from an instrumented revision would fail. Give the task definition an execution role granting secretsmanager:GetSecretValue on that secret, then run this command again.`
    )
  }

  const containers = taskDefinition.containerDefinitions ?? []
  const existingAgent = containers.find((container) => container.name === AGENT_CONTAINER_NAME)
  const {container: agentContainer, warnings} = buildAgentContainer({
    settings,
    existing: existingAgent,
    logConfiguration: borrowedLogConfiguration(containers),
  })

  if (!agentContainer.logConfiguration) {
    warnings.push(
      `The ${AGENT_CONTAINER_NAME} container has no logConfiguration, so its own logs will not be collected and a failing Agent will be hard to diagnose. Add one to the task definition.`
    )
  }

  // Task collection reads the ECS API as the task role, so a task definition without one collects
  // nothing. The permissions it needs are the command's to name, not to grant.
  if (!taskDefinition.taskRoleArn) {
    warnings.push(
      `Task definition ${family} has no taskRoleArn, so the Agent cannot collect ECS task metadata. Give the task definition a task role granting ${ECS_TASK_COLLECTION_ACTIONS.join(', ')} for the task, container, and image tags this metadata provides.`
    )
  }

  const appEnvironment = getAppContainerEnvVars()
  const containerDefinitions = containers.map((container) =>
    container.name === AGENT_CONTAINER_NAME
      ? agentContainer
      : removeUndefinedValues({
          ...container,
          environment: toEnvironment(appEnvironment, container.environment),
        })
  )
  if (!existingAgent) {
    containerDefinitions.push(agentContainer)
  }

  return {
    taskDefinition: {
      ...stripReadOnlyFields(taskDefinition),
      containerDefinitions,
      tags: instrumentationTags(tags),
    },
    warnings,
  }
}

/**
 * Masks a value that is known to be a credential. `maskString` is not used here because it lets
 * values that look like numbers or booleans through, which an API key is free to look like.
 */
const maskApiKey = (apiKey: string): string =>
  apiKey.length < 12 ? '*'.repeat(16) : `${apiKey.slice(0, 2)}${'*'.repeat(10)}${apiKey.slice(-4)}`

/**
 * The task definition with any plaintext API key masked, for printing. The diff goes to stdout,
 * which in CI is a log that outlives the run, so the key a `DD_API_KEY` fallback writes must not
 * reach it.
 */
export const withMaskedApiKey = (input: RegisterTaskDefinitionCommandInput): RegisterTaskDefinitionCommandInput => ({
  ...input,
  containerDefinitions: input.containerDefinitions?.map((container) => ({
    ...container,
    environment: container.environment?.map((envVar) =>
      envVar.name === API_KEY_ENV_VAR && envVar.value !== undefined
        ? {...envVar, value: maskApiKey(envVar.value)}
        : envVar
    ),
  })),
})

const withoutCliVersionTag = (input: RegisterTaskDefinitionCommandInput): RegisterTaskDefinitionCommandInput => ({
  ...input,
  tags: (input.tags ?? []).filter((tag) => tag.key !== SERVERLESS_CLI_VERSION_TAG_NAME),
})

/**
 * Whether the task definition already matches what instrumentation would register, ignoring the
 * CLI version tag so that upgrading datadog-ci alone does not produce a new revision.
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
 * described task definition can be registered as a new revision. `family` and
 * `containerDefinitions` are restated because the register input requires those keys to be present.
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
