import type {
  ContainerDefinition,
  KeyValuePair,
  LogConfiguration,
  MountPoint,
  RegisterTaskDefinitionCommandInput,
  Secret,
  Tag,
  TaskDefinition,
  Volume,
} from '@aws-sdk/client-ecs'

import {sortedEqual} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  AGENT_IMAGE,
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
  AGENT_LOOPBACK_HOST,
  AGENT_SOCKET_MOUNT_PATH,
  AGENT_SOCKET_VOLUME_NAME,
  APM_SOCKET_URL,
  AWSLOGS_LOG_DRIVER,
  AWSVPC_NETWORK_MODE,
  DD_AGENT_HOST_ENV_VAR,
  DD_APM_ENABLED_ENV_VAR,
  DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT_ENV_VAR,
  DD_DOGSTATSD_ORIGIN_DETECTION_ENV_VAR,
  DD_DOGSTATSD_TAG_CARDINALITY_ENV_VAR,
  DD_DOGSTATSD_URL_ENV_VAR,
  DD_ECS_TASK_COLLECTION_ENABLED_ENV_VAR,
  DD_TRACE_AGENT_URL_ENV_VAR,
  DD_USE_DOGSTATSD_ENV_VAR,
  DOCKER_LABEL_ENV,
  DOCKER_LABEL_SERVICE,
  DOCKER_LABEL_VERSION,
  DOGSTATSD_ORCHESTRATOR_CARDINALITY,
  DOGSTATSD_SOCKET_URL,
  ECS_FARGATE_ENV_VAR,
  ECS_TASK_COLLECTION_ACTIONS,
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
  /**
   * Whether the tracers reach the Agent over the shared Unix socket rather than the task loopback
   * address. Absent enables it.
   */
  agentSocket?: boolean
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
 * Values to write to a container, split by how strongly the command owns them.
 */
type ManagedValues = {
  /** Owned by the command: these replace what the task definition had. */
  managed: Record<string, string>
  /** Suggested by the command: a value already on the container wins. */
  defaults: Record<string, string>
  /**
   * Owned by the command but not part of this configuration, so they are dropped. Without this, a
   * setting the command stops writing would linger from an earlier run under different flags.
   */
  removed?: string[]
}

/**
 * Merges the values the command writes into the ones already on the container, by name: defaults
 * fill in what is missing, managed values replace what is there, and removed names are dropped.
 *
 * Existing entries keep their position, so that re-running produces an identical result rather than
 * a reordered one that would show up as a diff. Shared by the environment variables and the Docker
 * labels, so the two can never disagree on what overrides what.
 */
const mergeManaged = <T>(
  {managed, defaults, removed}: ManagedValues,
  existing: Iterable<readonly [string, T]>
): Map<string, string | T> => {
  const merged = new Map<string, string | T>(existing)
  for (const name of removed ?? []) {
    merged.delete(name)
  }
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
 * The unified service tags, which every container in the task carries so that the telemetry the
 * tracers and the Agent send line up.
 *
 * An explicit `--service` takes precedence. Otherwise derived from the family the task definition is named after
 */
const getServiceTagEnvVars = (settings: InstrumentSettings, family?: string): ManagedValues => {
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
 * The unified service tags as Docker labels, which the application containers carry so that the
 * metrics the Agent collects about them are tagged like the telemetry their tracers send. As with
 * the environment variables, an explicit `--service` overrides, while the family is a fallback.
 */
const getUstDockerLabels = (settings: InstrumentSettings, family?: string): ManagedValues => {
  const managed: Record<string, string> = {}
  const defaults: Record<string, string> = {}

  if (settings.service) {
    managed[DOCKER_LABEL_SERVICE] = settings.service
  } else if (family) {
    defaults[DOCKER_LABEL_SERVICE] = family
  }
  if (settings.environment) {
    managed[DOCKER_LABEL_ENV] = settings.environment
  }
  if (settings.version) {
    managed[DOCKER_LABEL_VERSION] = settings.version
  }

  return {managed, defaults}
}

/**
 * Builds the environment the Agent sidecar runs with.
 */
const getAgentEnvVars = (settings: InstrumentSettings, family?: string): ManagedValues => {
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
    defaults: {
      [DD_DOGSTATSD_ORIGIN_DETECTION_ENV_VAR]: 'true',
      [DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT_ENV_VAR]: 'true',
      [DD_DOGSTATSD_TAG_CARDINALITY_ENV_VAR]: DOGSTATSD_ORCHESTRATOR_CARDINALITY,
      ...serviceTags.defaults,
    },
  }
}

/**
 * Builds the environment the application containers run with: the unified service tags, the
 * switches the tracer libraries read, and where they send what they produce.
 *
 * Tracing and log injection are defaults rather than managed values, so a task definition that has
 * already made a choice about either keeps it. The products the user turns on explicitly are managed.
 * The transport is managed too, because it has to agree with the volume mounts: the two ways of
 * reaching the Agent are mutually exclusive, so the unused one is removed rather than left behind
 * to point at a socket that is no longer mounted.
 */
const getAppContainerEnvVars = (settings: InstrumentSettings, family?: string): ManagedValues => {
  const serviceTags = getServiceTagEnvVars(settings, family)
  const socketEnabled = settings.agentSocket !== false
  const managed: Record<string, string> = {...serviceTags.managed}

  if (socketEnabled) {
    managed[DD_TRACE_AGENT_URL_ENV_VAR] = APM_SOCKET_URL
    managed[DD_DOGSTATSD_URL_ENV_VAR] = DOGSTATSD_SOCKET_URL
  } else {
    managed[DD_AGENT_HOST_ENV_VAR] = AGENT_LOOPBACK_HOST
  }

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
    removed: socketEnabled ? [DD_AGENT_HOST_ENV_VAR] : [DD_TRACE_AGENT_URL_ENV_VAR, DD_DOGSTATSD_URL_ENV_VAR],
    defaults: {
      ...serviceTags.defaults,
      [DD_TRACE_ENABLED_ENV_VAR]: 'true',
      [LOGS_INJECTION_ENV_VAR]: 'true',
    },
  }
}

const SOCKET_VOLUME: Volume = {name: AGENT_SOCKET_VOLUME_NAME}

const SOCKET_MOUNT: MountPoint = {
  sourceVolume: AGENT_SOCKET_VOLUME_NAME,
  containerPath: AGENT_SOCKET_MOUNT_PATH,
  readOnly: false,
}

/**
 * The container's mount points with the socket volume mounted or unmounted. Everything else is left
 * alone, in place, so that re-running produces an identical result. A container that declares no
 * mount points and needs none keeps declaring none.
 */
const withSocketMount = (existing: MountPoint[] | undefined, socketEnabled: boolean): MountPoint[] | undefined => {
  const mounts = existing ?? []
  const isSocketMount = (mount: MountPoint) => mount.sourceVolume === AGENT_SOCKET_VOLUME_NAME

  if (!socketEnabled) {
    return existing && mounts.filter((mount) => !isSocketMount(mount))
  }

  return mounts.some(isSocketMount)
    ? mounts.map((mount) => (isSocketMount(mount) ? SOCKET_MOUNT : mount))
    : [...mounts, SOCKET_MOUNT]
}

/**
 * The task's volumes with the socket volume present or absent, leaving the volumes the task
 * definition already declares in place.
 */
const withSocketVolume = (existing: Volume[] | undefined, socketEnabled: boolean): Volume[] | undefined => {
  const volumes = existing ?? []
  const isSocketVolume = (volume: Volume) => volume.name === AGENT_SOCKET_VOLUME_NAME

  if (!socketEnabled) {
    return existing && volumes.filter((volume) => !isSocketVolume(volume))
  }

  return volumes.some(isSocketVolume) ? volumes : [...volumes, SOCKET_VOLUME]
}

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

/**
 * The Docker labels to give a container: what the command writes, merged into what it already
 * carries. Absent when empty, so `isUpToDate` does not read a new empty map as a change.
 */
const toDockerLabels = (
  values: ManagedValues,
  existing?: Record<string, string>
): Record<string, string> | undefined => {
  const merged = mergeManaged(values, Object.entries(existing ?? {}))

  return merged.size > 0 ? Object.fromEntries(merged) : undefined
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
  /** The task definition family, used to name the service when the user did not. */
  family?: string
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
const buildAgentContainer = ({
  settings,
  family,
  existing,
  logConfiguration,
}: AgentContainerContext): AgentContainerResult => {
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
    environment: toEnvironment(getAgentEnvVars(settings, family), inheritedEnvironment),
    secrets,
    healthCheck,
    // The other end of the socket the tracers write to. The Agent image already listens on this
    // path, so mounting the volume is all it takes.
    mountPoints: withSocketMount(existing?.mountPoints, settings.agentSocket !== false),
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
    family,
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

  // The Agent is left out of the Docker labels on purpose: they tag the metrics collected about the
  // container carrying them, so an Agent labelled with the application's service would report its
  // own resource usage under that service.
  const socketEnabled = settings.agentSocket !== false
  const appEnvironment = getAppContainerEnvVars(settings, family)
  const appLabels = getUstDockerLabels(settings, family)
  const containerDefinitions = containers.map((container) =>
    container.name === AGENT_CONTAINER_NAME
      ? agentContainer
      : removeUndefinedValues({
          ...container,
          environment: toEnvironment(appEnvironment, container.environment),
          dockerLabels: toDockerLabels(appLabels, container.dockerLabels),
          mountPoints: withSocketMount(container.mountPoints, socketEnabled),
        })
  )
  if (!existingAgent) {
    containerDefinitions.push(agentContainer)
  }

  return {
    taskDefinition: removeUndefinedValues({
      ...stripReadOnlyFields(taskDefinition),
      containerDefinitions,
      volumes: withSocketVolume(taskDefinition.volumes, socketEnabled),
      tags: instrumentationTags(tags, settings, settings.service ?? family),
    }),
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

/**
 * The task definition without the tag recording the CLI version that produced it, which is the only
 * place that version appears.
 */
const withoutCliVersion = (input: RegisterTaskDefinitionCommandInput): RegisterTaskDefinitionCommandInput => ({
  ...input,
  tags: (input.tags ?? []).filter((tag) => tag.key !== SERVERLESS_CLI_VERSION_TAG_NAME),
})

/**
 * Whether the task definition already matches what instrumentation would register, ignoring the CLI
 * version so that upgrading datadog-ci alone does not produce a new revision. A revision registered
 * for another reason still picks up the current version.
 */
export const isUpToDate = (
  original: RegisterTaskDefinitionCommandInput,
  updated: RegisterTaskDefinitionCommandInput
): boolean => sortedEqual(withoutCliVersion(original), withoutCliVersion(updated))

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
