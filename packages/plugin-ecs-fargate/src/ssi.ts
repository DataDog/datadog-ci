import type {
  ContainerDefinition,
  KeyValuePair,
  LogConfiguration,
  MountPoint,
  Tag,
  TaskDefinition,
  Volume,
} from '@aws-sdk/client-ecs'
import type {CompositeInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import type {
  InjectionConfig,
  ResolvedSsiConfig,
  SsiConfigResult,
  SsiOptions,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
import type {EnvOps} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env-merge'
import type {LanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {ManagedTracerConfig, TracerArtifacts} from '@datadog/datadog-ci-base/helpers/serverless/ssi/recognition'

import {DD_TAGS_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  getInjectionMountPath,
  resolveInjectionConfig,
  selectApplicationContainer as selectContainer,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
import {
  SSI_INJECTION_MODE_TAG,
  TRACER_CONTAINER_NAME,
  TRACER_COPY_ENTRYPOINT,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {hasInjectionModeTag, mergeInjectionModeTag} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  assertFragmentsCanBeMerged,
  findEnv,
  hasAllFragments,
  mergeFragments,
  removeFragmentGroups,
  upsertEnv,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env-merge'
import {
  getInjectedTracer,
  getInjectionEnvGroups,
  getManagedTracerConfig,
  getManagedTracerMountPaths,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/recognition'
import {removeUndefinedValues} from '@datadog/datadog-ci-base/helpers/utils'

import {
  AGENT_CONTAINER_NAME,
  LOG_ROUTER_CONTAINER_NAME,
  SUCCESS_DEPENDENCY_CONDITION,
  TRACER_USER,
  isWindowsTask,
} from './constants'

export {SsiConfigError} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
export type {InjectionConfig, ResolvedSsiConfig, SsiConfigResult, SsiOptions}

export const ECS_FARGATE_TRACER_REGISTRY = 'public.ecr.aws/datadog' as const

const RESERVED_CONTAINER_NAMES = new Set([AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME, TRACER_CONTAINER_NAME])
const INJECTION_ENV_GROUPS = getInjectionEnvGroups(ECS_FARGATE_TRACER_REGISTRY)
const MANAGED_TRACER_MOUNT_PATHS = getManagedTracerMountPaths(ECS_FARGATE_TRACER_REGISTRY)

/** Resolves ECS Fargate tracer inputs before any remote work. */
export const resolveSsiConfig = (config: SsiOptions): SsiConfigResult =>
  resolveInjectionConfig(config, {
    registry: ECS_FARGATE_TRACER_REGISTRY,
    languageAliases: {dotnet: 'csharp'},
  })

export const selectApplicationContainer = (
  containers: readonly ContainerDefinition[],
  requestedName: string | undefined
): number =>
  selectContainer(containers, requestedName, {
    reservedNames: RESERVED_CONTAINER_NAMES,
    noCandidatesHint: 'Add an application container, then retry.',
  })

/**
 * Rejects an application container whose environment injection cannot merge into.
 *
 * Asked of the container as the task definition declares it, before the command merges its own
 * environment in: that merge resolves duplicate names to the last one, which would hide the
 * duplicate this reports.
 */
export const assertInjectionEnvCanBeMerged = (container: ContainerDefinition, config: InjectionConfig): void =>
  assertFragmentsCanBeMerged(
    container.environment ?? [],
    config.spec.env,
    config.kind === 'single-language' ? [DD_TAGS_ENV_VAR] : [],
    injectionEnvOps(container)
  )

export const mergeLanguageInjectionEnv = (
  container: ContainerDefinition,
  spec: LanguageInjectionSpec
): KeyValuePair[] => {
  const ops = injectionEnvOps(container)
  const merged = mergeFragments(container.environment ?? [], spec.env, [DD_TAGS_ENV_VAR], ops)
  const existingTags = findEnv(merged, DD_TAGS_ENV_VAR, ops)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value), ops)
}

export const mergeCompositeInjectionEnv = (
  container: ContainerDefinition,
  spec: CompositeInjectionSpec
): KeyValuePair[] => mergeFragments(container.environment ?? [], spec.env, [], injectionEnvOps(container))

/** Removes the tracer startup environment of every supported injection mode. */
export const removeInjectionEnv = (container: ContainerDefinition, windows: boolean): KeyValuePair[] | undefined =>
  container.environment &&
  removeFragmentGroups(container.environment, INJECTION_ENV_GROUPS, containerEnvOps(container, windows))

/**
 * Whether the task definition carries instrumentation this command would have written.
 *
 * Only used to tell the customer that an omitted `--tracing` is about to remove their injected
 * tracer. Cleanup never consults it: it runs over the Datadog-owned names unconditionally.
 */
export const hasSsi = (taskDefinition: TaskDefinition, tags: Tag[] = []): boolean =>
  hasSsiMarker(taskDefinition, tags) ||
  (taskDefinition.containerDefinitions ?? []).some((_, index) => hasCompleteSsiSignature(taskDefinition, index))

/**
 * Whether the task definition declares anything under a name instrumentation owns.
 *
 * Paired with {@link hasSsi} to tell the customer that their own `datadog-tracer` container or
 * volume is being replaced, rather than removing it silently.
 */
export const hasManagedTracerNames = (taskDefinition: TaskDefinition): boolean =>
  (taskDefinition.containerDefinitions ?? []).some(({name}) => name === TRACER_CONTAINER_NAME) ||
  (taskDefinition.volumes ?? []).some(({name}) => name === TRACER_VOLUME_NAME)

/**
 * The warning that this command is about to take over a tracer name or mount path it owns, when
 * that artifact is not one it would have written. Cleanup still runs; this is only so the customer
 * is told rather than having their mount disappear in the diff.
 */
export const managedTracerReplacementWarning = (
  taskDefinition: TaskDefinition,
  family: string | undefined
): string | undefined => {
  if (hasManagedTracerNames(taskDefinition)) {
    return `Task definition ${family} declares a ${TRACER_CONTAINER_NAME} container or volume that this command did not write. It owns that name and rebuilds it on every run, so yours is being replaced. Rename it to keep it.`
  }

  const path = ownedTracerMountPath(taskDefinition)
  if (path === undefined) {
    return undefined
  }

  return `Task definition ${family} mounts ${path}, which this command owns. It rebuilds that mount on every run, so yours is being replaced. Use a different path to keep it.`
}

const ownedTracerMountPath = (taskDefinition: TaskDefinition): string | undefined => {
  for (const container of taskDefinition.containerDefinitions ?? []) {
    for (const {containerPath} of container.mountPoints ?? []) {
      if (MANAGED_TRACER_MOUNT_PATHS.has(containerPath ?? '')) {
        return containerPath
      }
    }
  }
}

/**
 * The task definition with every tracer artifact instrumentation owns removed: the tracer
 * container, its volume and mounts, the dependencies on it, and the startup environment each
 * injection mode writes.
 *
 * Ownership is the deterministic names and the tracer mount paths, not a judgement about who wrote
 * them, so this also clears state an older release or another tool left behind. A tracer installed
 * in the application image names none of those, so it survives.
 */
export const removeSsiState = (taskDefinition: TaskDefinition): TaskDefinition => {
  const windows = isWindowsTask(taskDefinition)
  const containerDefinitions = (taskDefinition.containerDefinitions ?? [])
    .filter(({name}) => name !== TRACER_CONTAINER_NAME)
    .map((container) => {
      const environment = removeInjectionEnv(container, windows)
      const mountPoints = container.mountPoints?.filter(
        ({sourceVolume, containerPath}) =>
          sourceVolume !== TRACER_VOLUME_NAME && !MANAGED_TRACER_MOUNT_PATHS.has(containerPath ?? '')
      )
      const dependsOn = container.dependsOn?.filter(({containerName}) => containerName !== TRACER_CONTAINER_NAME)

      return removeUndefinedValues({
        ...container,
        environment: environment?.length ? environment : undefined,
        mountPoints: mountPoints?.length ? mountPoints : undefined,
        dependsOn: dependsOn?.length ? dependsOn : undefined,
      })
    })

  return removeUndefinedValues({
    ...taskDefinition,
    containerDefinitions,
    volumes: taskDefinition.volumes?.filter(({name}) => name !== TRACER_VOLUME_NAME),
  })
}

/**
 * Adds the tracer container, its volume, and the mount and startup environment the selected
 * application container needs to load the tracer.
 *
 * Only reachable on Linux tasks, which is why the environment merge matches names exactly.
 */
export const applySsi = (
  containers: ContainerDefinition[],
  volumes: Volume[] | undefined,
  targetIndex: number,
  config: InjectionConfig,
  logConfiguration: LogConfiguration | undefined
): {containerDefinitions: ContainerDefinition[]; volumes: Volume[]} => {
  const mountPath = getInjectionMountPath(config)
  const tracerMount: MountPoint = {sourceVolume: TRACER_VOLUME_NAME, containerPath: mountPath, readOnly: false}
  const containerDefinitions = containers.map((container, index) =>
    index === targetIndex
      ? removeUndefinedValues({
          ...container,
          environment:
            config.kind === 'single-language'
              ? mergeLanguageInjectionEnv(container, config.spec)
              : mergeCompositeInjectionEnv(container, config.spec),
          mountPoints: [...(container.mountPoints ?? []), tracerMount],
          dependsOn: [
            ...(container.dependsOn ?? []),
            {containerName: TRACER_CONTAINER_NAME, condition: SUCCESS_DEPENDENCY_CONDITION},
          ],
        })
      : container
  )
  containerDefinitions.push(buildTracerContainer(config.spec.image, mountPath, logConfiguration))

  return {containerDefinitions, volumes: [...(volumes ?? []), {name: TRACER_VOLUME_NAME}]}
}

const hasSsiMarker = (taskDefinition: TaskDefinition, tags: Tag[]): boolean => {
  const windows = isWindowsTask(taskDefinition)

  return (
    tags.some((tag) => tag.key === SSI_INJECTION_MODE_TAG) ||
    (taskDefinition.containerDefinitions ?? []).some((container) => {
      const ops = containerEnvOps(container, windows)

      return hasInjectionModeTag(findEnv(container.environment ?? [], DD_TAGS_ENV_VAR, ops)?.value)
    })
  )
}

const hasCompleteSsiSignature = (taskDefinition: TaskDefinition, targetIndex: number): boolean => {
  const target = (taskDefinition.containerDefinitions ?? [])[targetIndex]
  if (!target) {
    return false
  }

  const injected = getInjectedTracer(tracerArtifacts(taskDefinition), targetIndex)

  return (
    injected !== undefined &&
    target.dependsOn?.some(
      (dependency) =>
        dependency.containerName === TRACER_CONTAINER_NAME && dependency.condition === SUCCESS_DEPENDENCY_CONDITION
    ) === true &&
    hasManagedTracerEnvironment(target, injected, isWindowsTask(taskDefinition))
  )
}

const tracerArtifacts = (taskDefinition: TaskDefinition): TracerArtifacts => {
  const containers = taskDefinition.containerDefinitions ?? []
  const recognized = containers.map(managedTracerConfig)

  return {
    tracers: recognized.filter((config): config is ManagedTracerConfig => config !== undefined),
    volumeCount: (taskDefinition.volumes ?? []).filter(({name}) => name === TRACER_VOLUME_NAME).length,
    // The tracer container mounts the volume it copies into, so only the mounts the other containers
    // declare say which application container the tracer was injected for.
    mounts: containers.flatMap((container, index) =>
      recognized[index] !== undefined
        ? []
        : (container.mountPoints ?? [])
            .filter(({sourceVolume}) => sourceVolume === TRACER_VOLUME_NAME)
            .map(({containerPath}) => ({index, path: containerPath ?? ''}))
    ),
  }
}

const hasManagedTracerEnvironment = (
  container: ContainerDefinition,
  config: ManagedTracerConfig,
  windows: boolean
): boolean => {
  const ops = containerEnvOps(container, windows)

  return config.envVariants.some((fragments) => hasAllFragments(container.environment ?? [], fragments, ops))
}

const managedTracerConfig = (container: ContainerDefinition): ManagedTracerConfig | undefined => {
  const config = getManagedTracerConfig(container.image, ECS_FARGATE_TRACER_REGISTRY)

  return config !== undefined && hasManagedTracerContainerShape(container, config.mountPath) ? config : undefined
}

const hasManagedTracerContainerShape = (container: ContainerDefinition, mountPath: string): boolean =>
  container.name === TRACER_CONTAINER_NAME &&
  container.essential === false &&
  container.user === TRACER_USER &&
  container.entryPoint?.length === 1 &&
  container.entryPoint[0] === TRACER_COPY_ENTRYPOINT &&
  container.command?.length === 1 &&
  container.command[0] === mountPath &&
  container.mountPoints?.some(
    ({sourceVolume, containerPath}) => sourceVolume === TRACER_VOLUME_NAME && containerPath === mountPath
  ) === true

const buildTracerContainer = (
  image: string,
  mountPath: string,
  logConfiguration: LogConfiguration | undefined
): ContainerDefinition =>
  removeUndefinedValues({
    name: TRACER_CONTAINER_NAME,
    image,
    essential: false,
    user: TRACER_USER,
    entryPoint: [TRACER_COPY_ENTRYPOINT],
    command: [mountPath],
    mountPoints: [{sourceVolume: TRACER_VOLUME_NAME, containerPath: mountPath, readOnly: false}],
    logConfiguration,
  })

/** Windows resolves environment names without case, so matching does too. */
const containerEnvOps = (container: ContainerDefinition, windows: boolean): EnvOps<KeyValuePair> => {
  const matches = (declared: string | undefined, name: string): boolean =>
    windows ? declared?.toLowerCase() === name.toLowerCase() : declared === name

  return {
    matches: (variable, name) => matches(variable.name, name),
    valueOf: (variable) => (variable.name && variable.value ? variable.value : undefined),
    isSecretBacked: (name) => (container.secrets ?? []).some((secret) => matches(secret.name, name)),
    create: (name, value) => ({name, value}),
    withValue: (variable, value) => ({...variable, value}),
  }
}

// Injection is rejected on Windows tasks before anything is merged.
const injectionEnvOps = (container: ContainerDefinition): EnvOps<KeyValuePair> => containerEnvOps(container, false)
