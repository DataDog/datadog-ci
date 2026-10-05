import {execSync} from '../../helpers/exec'

import {AGENT_CONTAINER_NAME, parseJson, region} from './ecs-fargate-fixtures'

// The e2e job checks out only e2e/, so these mirror the plugin's constants rather than importing
// them. A rename on either side must be made deliberately on both.
const LOG_ROUTER_CONTAINER_NAME = 'datadog-log-router'
const TRACER_CONTAINER_NAME = 'datadog-tracer'
const AGENT_IMAGE = 'public.ecr.aws/datadog/agent:latest'
const LOG_ROUTER_IMAGE = 'public.ecr.aws/aws-observability/aws-for-fluent-bit:stable'
const TRACER_REGISTRY = 'public.ecr.aws/datadog'

const AGENT_SOCKET_VOLUME_NAME = 'dd-sockets'
const AGENT_SOCKET_MOUNT_PATH = '/var/run/datadog'
const TRACER_VOLUME_NAME = 'datadog-tracer'
const TRACER_MOUNT_PATH = '/datadog-lib'
const COMPOSITE_TRACER_MOUNT_PATH = '/opt/datadog-packages'
const TRACER_COPY_ENTRYPOINT = '/datadog-init/copy-lib.sh'

const SERVERLESS_CI_TAG = 'dd_sls_ci'
const SSI_INJECTION_MODE_TAG = 'dd_sls_injection_mode'
const INSTRUMENTATION_TAG_KEYS = ['service', 'env', 'version', SERVERLESS_CI_TAG, SSI_INJECTION_MODE_TAG]

const DOCKER_LABEL_SERVICE = 'com.datadoghq.tags.service'
const DOCKER_LABEL_ENV = 'com.datadoghq.tags.env'
const DOCKER_LABEL_VERSION = 'com.datadoghq.tags.version'

const SIDECAR_NAMES = [AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME, TRACER_CONTAINER_NAME]

export interface ContainerDefinition {
  name: string
  image: string
  essential?: boolean
  user?: string
  entryPoint?: string[]
  command?: string[]
  environment?: {name: string; value: string}[]
  secrets?: {name: string; valueFrom: string}[]
  dockerLabels?: Record<string, string>
  mountPoints?: {sourceVolume: string; containerPath: string; readOnly?: boolean}[]
  dependsOn?: {containerName: string; condition: string}[]
  healthCheck?: {command: string[]; interval?: number; timeout?: number; retries?: number; startPeriod?: number}
  firelensConfiguration?: {type: string; options?: Record<string, string>}
  logConfiguration?: {
    logDriver: string
    options?: Record<string, string>
    secretOptions?: {name: string; valueFrom: string}[]
  }
}

export interface DescribedTaskDefinition {
  family: string
  revision: number
  taskDefinitionArn: string
  containerDefinitions: ContainerDefinition[]
  volumes?: {name: string}[]
  tags: Record<string, string>
}

export const describeTaskDefinition = (taskDefinition: string): DescribedTaskDefinition => {
  const described = parseJson<{
    taskDefinition: Omit<DescribedTaskDefinition, 'tags'>
    tags?: {key: string; value: string}[]
  }>(
    execSync(
      `aws ecs describe-task-definition --task-definition "${taskDefinition}" --include TAGS --region "${region}" --output json`
    )
  )

  return {
    ...described.taskDefinition,
    volumes: described.taskDefinition.volumes ?? [],
    tags: Object.fromEntries((described.tags ?? []).map(({key, value}) => [key, value])),
  }
}

const containerNamed = (taskDefinition: DescribedTaskDefinition, name: string): ContainerDefinition | undefined =>
  taskDefinition.containerDefinitions.find((container) => container.name === name)

const applicationContainers = (taskDefinition: DescribedTaskDefinition): ContainerDefinition[] =>
  taskDefinition.containerDefinitions.filter((container) => !SIDECAR_NAMES.includes(container.name))

const envByName = (container: ContainerDefinition): Record<string, string> =>
  Object.fromEntries((container.environment ?? []).map(({name, value}) => [name, value]))

const hasVolume = (taskDefinition: DescribedTaskDefinition, name: string): boolean =>
  (taskDefinition.volumes ?? []).some((volume) => volume.name === name)

const mountPathsOf = (container: ContainerDefinition, sourceVolume: string): string[] =>
  (container.mountPoints ?? [])
    .filter((mount) => mount.sourceVolume === sourceVolume)
    .map(({containerPath}) => containerPath)

/**
 * The instrumentation-relevant state, so that two revisions can be compared for equality across an
 * idempotent re-run. Environment and tags are sorted because neither side guarantees an order.
 */
export interface TaskDefinitionSnapshot {
  containers: unknown[]
  volumes: string[]
  tags: [string, string][]
}

export const getTaskDefinitionSnapshot = (taskDefinition: string): TaskDefinitionSnapshot => {
  const described = describeTaskDefinition(taskDefinition)

  return {
    containers: described.containerDefinitions.map((container) => ({
      ...container,
      environment: [...(container.environment ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      secrets: [...(container.secrets ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    })),
    volumes: (described.volumes ?? []).map(({name}) => name).sort(),
    tags: Object.entries(described.tags).sort(([a], [b]) => a.localeCompare(b)),
  }
}

export interface InstrumentExpectation {
  service: string
  env: string
  version: string
  appContainerName: string
}

/**
 * The Agent sidecar, the socket transport, the unified service tags, and the revision tags every
 * successful `instrument` writes, whatever else was asked for.
 */
export const verifyInstrumented = (
  taskDefinition: string,
  {service, env, version, appContainerName}: InstrumentExpectation
): void => {
  console.log(`Fetching task definition "${taskDefinition}"...`)
  const described = describeTaskDefinition(taskDefinition)
  console.log('\nVerifying instrumented task definition state:\n')

  const agent = containerNamed(described, AGENT_CONTAINER_NAME)
  expect(agent).toBeDefined()
  expect(agent!.image).toBe(AGENT_IMAGE)
  // A crashed Agent must cost telemetry, not availability.
  expect(agent!.essential).toBe(false)
  expect(agent!.healthCheck?.command).toEqual(['CMD-SHELL', '/probe.sh'])

  const agentEnv = envByName(agent!)
  expect(agentEnv.ECS_FARGATE).toBe('true')
  expect(agentEnv.DD_SITE).toBeDefined()
  expect(agentEnv.DD_APM_ENABLED).toBe('true')
  expect(agentEnv.DD_USE_DOGSTATSD).toBe('true')
  expect(agentEnv.DD_ECS_TASK_COLLECTION_ENABLED).toBe('true')
  expect(agentEnv.DD_DOGSTATSD_TAG_CARDINALITY).toBe('orchestrator')
  expect(agentEnv.DD_SERVICE).toBe(service)
  expect(agentEnv.DD_ENV).toBe(env)
  expect(agentEnv.DD_VERSION).toBe(version)

  const app = containerNamed(described, appContainerName)
  expect(app).toBeDefined()
  const appEnv = envByName(app!)
  expect(appEnv.DD_SERVICE).toBe(service)
  expect(appEnv.DD_ENV).toBe(env)
  expect(appEnv.DD_VERSION).toBe(version)
  expect(appEnv.DD_TRACE_ENABLED).toBe('true')

  // The tracers and the Agent must agree on the transport: both ends of the socket, or neither.
  expect(appEnv.DD_TRACE_AGENT_URL).toBe(`unix://${AGENT_SOCKET_MOUNT_PATH}/apm.socket`)
  expect(appEnv.DD_DOGSTATSD_URL).toBe(`unix://${AGENT_SOCKET_MOUNT_PATH}/dsd.socket`)
  expect(appEnv.DD_AGENT_HOST).toBeUndefined()
  expect(hasVolume(described, AGENT_SOCKET_VOLUME_NAME)).toBe(true)
  expect(mountPathsOf(app!, AGENT_SOCKET_VOLUME_NAME)).toEqual([AGENT_SOCKET_MOUNT_PATH])
  expect(mountPathsOf(agent!, AGENT_SOCKET_VOLUME_NAME)).toEqual([AGENT_SOCKET_MOUNT_PATH])

  // The labels tag what the Agent observes from outside the container, as the environment tags what
  // the tracer inside it sends. The Agent is deliberately unlabeled, so it reports as itself.
  expect(app!.dockerLabels?.[DOCKER_LABEL_SERVICE]).toBe(service)
  expect(app!.dockerLabels?.[DOCKER_LABEL_ENV]).toBe(env)
  expect(app!.dockerLabels?.[DOCKER_LABEL_VERSION]).toBe(version)
  expect(agent!.dockerLabels?.[DOCKER_LABEL_SERVICE]).toBeUndefined()

  expect(described.tags.service).toBe(service)
  expect(described.tags.env).toBe(env)
  expect(described.tags.version).toBe(version)
  expect(described.tags[SERVERLESS_CI_TAG]).toBeDefined()

  console.log('\nAll instrumented task definition checks passed.')
}

/** The API key stays a Secrets Manager reference, never a value in the task definition. */
export const verifyApiKeyFromSecret = (taskDefinition: string, secretArn: string): void => {
  const described = describeTaskDefinition(taskDefinition)
  const agent = containerNamed(described, AGENT_CONTAINER_NAME)

  expect(agent!.secrets).toContainEqual({name: 'DD_API_KEY', valueFrom: secretArn})
  expect(envByName(agent!).DD_API_KEY).toBeUndefined()
}

/** Without a secret reference the key is written in plain text, and only to the Agent. */
export const verifyApiKeyPlaintext = (taskDefinition: string, apiKey: string): void => {
  const described = describeTaskDefinition(taskDefinition)
  const agent = containerNamed(described, AGENT_CONTAINER_NAME)

  expect(envByName(agent!).DD_API_KEY).toBe(apiKey)
  expect(agent!.secrets ?? []).not.toContainEqual(expect.objectContaining({name: 'DD_API_KEY'}))
  for (const container of applicationContainers(described)) {
    expect(envByName(container).DD_API_KEY).toBeUndefined()
  }
}

/** The FireLens router, and every other container routed through it. */
export const verifyLogCollection = (taskDefinition: string, {secretArn}: {secretArn?: string} = {}): void => {
  const described = describeTaskDefinition(taskDefinition)
  const router = containerNamed(described, LOG_ROUTER_CONTAINER_NAME)

  expect(router).toBeDefined()
  expect(router!.image).toBe(LOG_ROUTER_IMAGE)
  expect(router!.essential).toBe(false)
  expect(router!.user).toBe('0')
  expect(router!.firelensConfiguration?.type).toBe('fluentbit')

  for (const container of described.containerDefinitions) {
    if (container.name === LOG_ROUTER_CONTAINER_NAME) {
      continue
    }
    expect(container.logConfiguration?.logDriver).toBe('awsfirelens')
    expect(container.logConfiguration?.options?.Name).toBe('datadog')
    expect(container.logConfiguration?.options?.provider).toBe('ecs')
    if (secretArn) {
      expect(container.logConfiguration?.secretOptions).toContainEqual({name: 'apikey', valueFrom: secretArn})
      expect(container.logConfiguration?.options?.apikey).toBeUndefined()
    }
  }
}

export interface SsiExpectation {
  appContainerName: string
  /** The tracer image repository, for example `js` for Node.js. Omitted for composite injection. */
  tracerRepository?: string
  /** The startup variable the tracer image's copy activates, for example `NODE_OPTIONS`. */
  nativeEnv?: {name: string; value: string}
}

/**
 * The tracer container, the volume it copies into, and the startup environment that makes the
 * application container load what was copied.
 */
export const verifySsiInstrumented = (
  taskDefinition: string,
  {appContainerName, tracerRepository, nativeEnv}: SsiExpectation
): void => {
  console.log(`Fetching task definition "${taskDefinition}"...`)
  const described = describeTaskDefinition(taskDefinition)
  console.log('\nVerifying injected tracer state:\n')

  const composite = tracerRepository === undefined
  const mountPath = composite ? COMPOSITE_TRACER_MOUNT_PATH : TRACER_MOUNT_PATH
  const image = composite
    ? `${TRACER_REGISTRY}/dd-lib-composite-init:latest`
    : `${TRACER_REGISTRY}/dd-lib-${tracerRepository}-init:latest`

  const tracer = containerNamed(described, TRACER_CONTAINER_NAME)
  expect(tracer).toBeDefined()
  expect(tracer!.image).toBe(image)
  // The copy runs to completion and exits, so it must not be able to fail the task.
  expect(tracer!.essential).toBe(false)
  expect(tracer!.user).toBe('0')
  expect(tracer!.entryPoint).toEqual([TRACER_COPY_ENTRYPOINT])
  expect(tracer!.command).toEqual([mountPath])
  expect(mountPathsOf(tracer!, TRACER_VOLUME_NAME)).toEqual([mountPath])
  expect(hasVolume(described, TRACER_VOLUME_NAME)).toBe(true)

  // Only the selected application container gets the tracer; the Agent must not load it.
  const app = containerNamed(described, appContainerName)
  expect(mountPathsOf(app!, TRACER_VOLUME_NAME)).toEqual([mountPath])
  expect(app!.dependsOn).toContainEqual({containerName: TRACER_CONTAINER_NAME, condition: 'SUCCESS'})
  const agent = containerNamed(described, AGENT_CONTAINER_NAME)
  expect(mountPathsOf(agent!, TRACER_VOLUME_NAME)).toEqual([])

  const appEnv = envByName(app!)
  if (nativeEnv) {
    expect(appEnv[nativeEnv.name] ?? '').toContain(nativeEnv.value)
    expect(envByName(agent!)[nativeEnv.name]).toBeUndefined()
  } else {
    expect(appEnv.LD_PRELOAD ?? '').toContain(`${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject`)
    expect(appEnv.DD_INJECT_SENDER_TYPE).toBe('serverless')
  }

  expect(described.tags[SSI_INJECTION_MODE_TAG]).toBe(composite ? 'multi_language' : 'single_language')

  console.log('\nAll injected tracer checks passed.')
}

/** Nothing instrumentation owns is left on the revision. */
export const verifyUninstrumented = (taskDefinition: string): void => {
  console.log(`Fetching task definition "${taskDefinition}"...`)
  const described = describeTaskDefinition(taskDefinition)
  console.log('\nVerifying uninstrumented task definition state:\n')

  for (const name of SIDECAR_NAMES) {
    expect(containerNamed(described, name)).toBeUndefined()
  }
  expect(hasVolume(described, AGENT_SOCKET_VOLUME_NAME)).toBe(false)
  expect(hasVolume(described, TRACER_VOLUME_NAME)).toBe(false)

  for (const container of described.containerDefinitions) {
    expect(Object.keys(envByName(container)).filter((name) => name.startsWith('DD_'))).toHaveLength(0)
    expect((container.secrets ?? []).filter(({name}) => name.startsWith('DD_'))).toHaveLength(0)
    expect(container.dockerLabels?.[DOCKER_LABEL_SERVICE]).toBeUndefined()
    expect(container.dockerLabels?.[DOCKER_LABEL_ENV]).toBeUndefined()
    expect(container.dockerLabels?.[DOCKER_LABEL_VERSION]).toBeUndefined()
    expect(mountPathsOf(container, AGENT_SOCKET_VOLUME_NAME)).toEqual([])
    expect(mountPathsOf(container, TRACER_VOLUME_NAME)).toEqual([])
    expect(container.logConfiguration?.logDriver).not.toBe('awsfirelens')
  }

  for (const key of INSTRUMENTATION_TAG_KEYS) {
    expect(described.tags[key]).toBeUndefined()
  }

  console.log('\nAll uninstrumented task definition checks passed.')
}

/**
 * The startup fragment an injected tracer wrote, asserted gone after uninstrumenting. The value is
 * checked rather than the variable, because a variable the application already declared keeps its
 * own value and only loses the fragment instrumentation merged into it.
 */
export const verifyTracerEnvRemoved = (taskDefinition: string, {name, value}: {name: string; value: string}): void => {
  const described = describeTaskDefinition(taskDefinition)

  for (const container of described.containerDefinitions) {
    expect(envByName(container)[name] ?? '').not.toContain(value)
  }
}
