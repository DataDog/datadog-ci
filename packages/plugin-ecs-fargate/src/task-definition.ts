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
  API_KEY_ENV_VAR,
  DD_APPSEC_ENABLED_ENV_VAR,
  DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR,
  DD_LLMOBS_ENABLED_ENV_VAR,
  DD_LLMOBS_ML_APP_ENV_VAR,
  DD_LOG_LEVEL_ENV_VAR,
  DD_TAGS_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  VERSION_ENV_VAR,
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
  DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR,
  DD_USE_DOGSTATSD_ENV_VAR,
  ECS_FARGATE_ENV_VAR,
  ENVIRONMENT_TAG_KEY,
  LAUNCH_TYPE_FARGATE,
  READ_ONLY_TASK_DEFINITION_FIELDS,
  SERVICE_TAG_KEY,
  VERSION_TAG_KEY,
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
  /** The service name the user asked for. Absent means the task definition family is used instead. */
  service?: string
  environment?: string
  version?: string
  /** Additional tags, as the `key:value,key:value` string `DD_TAGS` takes. */
  extraTags?: string
  /** Additional environment variables to set on every container in the task. */
  envVars?: Record<string, string>
  /** Whether the tracers send traces. Absent leaves the choice to the task definition. */
  tracing?: boolean
  logLevel?: string
  appsec?: boolean
  /** The ML application name, when LLM Observability is enabled. */
  llmobs?: string
}

export type InstrumentResult = {
  taskDefinition: RegisterTaskDefinitionCommandInput
  warnings: string[]
}

/**
 * Environment variables to write to a container, split by how strongly the command owns them.
 */
type ManagedEnvironment = {
  /** Owned by the command: these replace what the task definition had. */
  managed: Record<string, string>
  /** Suggested by the command: a value already on the container wins. */
  defaults: Record<string, string>
}

/**
 * The unified service tags, which every container in the task carries so that the telemetry the
 * tracers and the Agent send line up.
 *
 * An explicit `--service` is authoritative. The family the task definition is named after is only a
 * fallback, since a container that sets `DD_SERVICE` itself knows better than a name we guessed.
 */
const getServiceTagEnvVars = (settings: InstrumentSettings, family?: string): ManagedEnvironment => {
  const managed: Record<string, string> = {}
  const defaults: Record<string, string> = {}

  if (settings.service) {
    managed[SERVICE_ENV_VAR] = settings.service
  } else if (family) {
    defaults[SERVICE_ENV_VAR] = family
  }
  if (settings.environment) {
    managed[ENVIRONMENT_ENV_VAR] = settings.environment
  }
  if (settings.version) {
    managed[VERSION_ENV_VAR] = settings.version
  }
  if (settings.extraTags) {
    managed[DD_TAGS_ENV_VAR] = settings.extraTags
  }
  if (settings.logLevel) {
    managed[DD_LOG_LEVEL_ENV_VAR] = settings.logLevel
  }

  return {managed, defaults}
}

/**
 * Builds the environment the Agent sidecar runs with.
 */
const getAgentEnvVars = (settings: InstrumentSettings, family?: string): ManagedEnvironment => {
  const serviceTags = getServiceTagEnvVars(settings, family)

  return {
    managed: {
      [ECS_FARGATE_ENV_VAR]: 'true',
      [SITE_ENV_VAR]: settings.site,
      // The Agent's own trace intake, which is a separate switch from the tracers' `DD_TRACE_ENABLED`.
      [DD_APM_ENABLED_ENV_VAR]: String(settings.tracing ?? true),
      [DD_USE_DOGSTATSD_ENV_VAR]: 'true',
      [DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR]: 'true',
      ...(settings.apiKey ? {[API_KEY_ENV_VAR]: settings.apiKey} : {}),
      ...serviceTags.managed,
      ...settings.envVars,
    },
    defaults: serviceTags.defaults,
  }
}

/**
 * Builds the environment the application containers run with: the unified service tags, plus the
 * switches the tracer libraries read.
 *
 * Tracing and log injection are defaults rather than managed values, so a task definition that has
 * already made a choice about either keeps it. The products the user turns on explicitly are managed.
 */
const getAppContainerEnvVars = (settings: InstrumentSettings, family?: string): ManagedEnvironment => {
  const serviceTags = getServiceTagEnvVars(settings, family)
  const managed: Record<string, string> = {...serviceTags.managed}

  if (settings.tracing !== undefined) {
    managed[DD_TRACE_ENABLED_ENV_VAR] = String(settings.tracing)
  }
  if (settings.appsec) {
    managed[DD_APPSEC_ENABLED_ENV_VAR] = 'true'
  }
  if (settings.llmobs) {
    managed[DD_LLMOBS_ENABLED_ENV_VAR] = 'true'
    managed[DD_LLMOBS_ML_APP_ENV_VAR] = settings.llmobs
    // The Agent sidecar forwards the payloads, so the tracer does not send them to the intake itself.
    managed[DD_LLMOBS_AGENTLESS_ENABLED_ENV_VAR] = 'false'
  }
  Object.assign(managed, settings.envVars)

  return {
    managed,
    defaults: {
      ...serviceTags.defaults,
      [DD_TRACE_ENABLED_ENV_VAR]: 'true',
      [LOGS_INJECTION_ENV_VAR]: 'true',
    },
  }
}

/**
 * Merges the environment variables the command writes into the ones already on the container, by
 * name: defaults fill in what is missing, managed values replace what is there.
 *
 * Existing variables keep their position so that re-running produces an identical array rather than
 * a reordered one that would show up as a diff.
 */
const toEnvironment = (environment: ManagedEnvironment, existing?: KeyValuePair[]): KeyValuePair[] => {
  const merged = new Map<string, string | undefined>()
  for (const {name, value} of existing ?? []) {
    if (name !== undefined) {
      merged.set(name, value)
    }
  }
  for (const [name, value] of Object.entries(environment.defaults)) {
    if (!merged.has(name)) {
      merged.set(name, value)
    }
  }
  for (const [name, value] of Object.entries(environment.managed)) {
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
const buildAgentContainer = (
  settings: InstrumentSettings,
  family?: string,
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
    image: settings.agentImage,
    // The Agent must not be able to take the task down: a crashed Agent should cost telemetry, not
    // availability.
    essential: false,
    environment: toEnvironment(getAgentEnvVars(settings, family), inheritedEnvironment),
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
 * The tags the revision carries: the unified service tags the task now reports under, and the
 * version of the CLI that produced the revision. Both replace whatever the task definition had.
 */
const instrumentationTags = (tags: Tag[], settings: InstrumentSettings, service?: string): Tag[] => {
  const managed = new Map<string, string>()
  if (service) {
    managed.set(SERVICE_TAG_KEY, service)
  }
  if (settings.environment) {
    managed.set(ENVIRONMENT_TAG_KEY, settings.environment)
  }
  if (settings.version) {
    managed.set(VERSION_TAG_KEY, settings.version)
  }
  managed.set(SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE)

  return [
    ...tags.filter((tag) => tag.key === undefined || !managed.has(tag.key)),
    ...[...managed].map(([key, value]) => ({key, value})),
  ]
}

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

  const containers = taskDefinition.containerDefinitions ?? []
  const existingAgent = containers.find((container) => container.name === AGENT_CONTAINER_NAME)
  const {container: agentContainer, warnings} = buildAgentContainer(
    settings,
    family,
    existingAgent,
    borrowedLogConfiguration(containers)
  )

  if (!agentContainer.logConfiguration) {
    warnings.push(
      `The ${AGENT_CONTAINER_NAME} container has no logConfiguration, so its own logs will not be collected and a failing Agent will be hard to diagnose. Add one to the task definition.`
    )
  }

  // ECS resolves secrets through the task's execution role, so a reference without a role in place
  // registers a revision whose tasks cannot start.
  if (settings.apiKeySecretArn && !taskDefinition.executionRoleArn) {
    warnings.push(
      `Task definition ${family} has no executionRoleArn, which ECS needs to read ${settings.apiKeySecretArn}. Tasks started from this revision will fail until the task definition has an execution role granting secretsmanager:GetSecretValue on that secret.`
    )
  }

  const appEnvironment = getAppContainerEnvVars(settings, family)
  const containerDefinitions = containers.map((container) =>
    container.name === AGENT_CONTAINER_NAME
      ? agentContainer
      : {...container, environment: toEnvironment(appEnvironment, container.environment)}
  )
  if (!existingAgent) {
    containerDefinitions.push(agentContainer)
  }

  return {
    taskDefinition: {
      ...stripReadOnlyFields(taskDefinition),
      containerDefinitions,
      tags: instrumentationTags(tags, settings, settings.service ?? family),
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
