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
  DOCKER_LABEL_ENV,
  DOCKER_LABEL_SERVICE,
  DOCKER_LABEL_VERSION,
  ECS_FARGATE_ENV_VAR,
  ENVIRONMENT_TAG_KEY,
  LAUNCH_TYPE_FARGATE,
  READ_ONLY_TASK_DEFINITION_FIELDS,
  SERVICE_TAG_KEY,
  VERSION_TAG_KEY,
  WINDOWS_AGENT_IMAGE_SUFFIX,
  WINDOWS_OS_FAMILY_PREFIX,
  WINDOWS_WORKING_DIRECTORY,
} from './constants'

/**
 * What the user asked for, resolved into the decisions the transform needs.
 */
export type InstrumentSettings = {
  /**
   * The Agent image to run. Absent leaves the choice to the transform, which picks the default build
   * for the task's platform.
   */
  agentImage?: string
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
 * a reordered one that would show up as a diff. Shared by the environment variables and the Docker
 * labels, so the two can never disagree on what overrides what.
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
const getAppContainerEnvVars = (settings: InstrumentSettings, family?: string): ManagedValues => {
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
 * Whether the task runs Windows containers, which the Agent sidecar has to be built differently
 * for. A task definition that declares no `runtimePlatform`, or declares `LINUX`, runs Linux.
 */
const isWindowsTask = (taskDefinition: TaskDefinition): boolean =>
  taskDefinition.runtimePlatform?.operatingSystemFamily?.toUpperCase().startsWith(WINDOWS_OS_FAMILY_PREFIX) ?? false

/**
 * The Agent image to run; either the one specified by the user, or the default build for the task's platform.
 */
const agentImage = (settings: InstrumentSettings, windows: boolean): string =>
  settings.agentImage ?? (windows ? `${AGENT_IMAGE}${WINDOWS_AGENT_IMAGE_SUFFIX}` : AGENT_IMAGE)

/**
 * What the Agent sidecar is built from.
 */
type AgentContainerContext = {
  settings: InstrumentSettings
  /** Whether the task runs Windows containers. */
  windows: boolean
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
  windows,
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

  // The Agent's probe is a shell script that only exists in the Linux image, so a Windows task gets
  // no health check rather than one that can never pass.
  const healthCheck = windows
    ? undefined
    : {
        command: [...AGENT_HEALTH_CHECK_COMMAND],
        interval: AGENT_HEALTH_CHECK_INTERVAL,
        timeout: AGENT_HEALTH_CHECK_TIMEOUT,
        retries: AGENT_HEALTH_CHECK_RETRIES,
        startPeriod: AGENT_HEALTH_CHECK_START_PERIOD,
      }
  if (windows) {
    warnings.push(
      `Leaving the ${AGENT_CONTAINER_NAME} container without a health check: the Agent's probe is a shell script that only its Linux image ships. Nothing will report whether the Agent is ready on this task.`
    )
  } else if (existing?.healthCheck && !sortedEqual(existing.healthCheck, healthCheck)) {
    warnings.push(`Replacing the health check on the ${AGENT_CONTAINER_NAME} container with the Agent's own probe.`)
  }

  const container = removeUndefinedValues({
    ...existing,
    name: AGENT_CONTAINER_NAME,
    image: agentImage(settings, windows),
    // The Agent must not be able to take the task down: a crashed Agent should cost telemetry, not
    // availability.
    essential: false,
    environment: toEnvironment(getAgentEnvVars(settings, family), inheritedEnvironment),
    secrets,
    healthCheck,
    // The Windows Agent image leaves the working directory unset, and the Agent needs one.
    workingDirectory: windows ? WINDOWS_WORKING_DIRECTORY : existing?.workingDirectory,
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

  const containers = taskDefinition.containerDefinitions ?? []
  const existingAgent = containers.find((container) => container.name === AGENT_CONTAINER_NAME)
  const {container: agentContainer, warnings} = buildAgentContainer({
    settings,
    windows: isWindowsTask(taskDefinition),
    family,
    existing: existingAgent,
    logConfiguration: borrowedLogConfiguration(containers),
  })

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

  // The Agent is left out of the Docker labels on purpose: they tag the metrics collected about the
  // container carrying them, so an Agent labelled with the application's service would report its
  // own resource usage under that service.
  const appEnvironment = getAppContainerEnvVars(settings, family)
  const appLabels = getUstDockerLabels(settings, family)
  const containerDefinitions = containers.map((container) =>
    container.name === AGENT_CONTAINER_NAME
      ? agentContainer
      : removeUndefinedValues({
          ...container,
          environment: toEnvironment(appEnvironment, container.environment),
          dockerLabels: toDockerLabels(appLabels, container.dockerLabels),
        })
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
