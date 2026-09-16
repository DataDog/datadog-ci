import type {Container, ContainerApp, EnvironmentVar, InitContainer} from '@azure/arm-appcontainers'
import type {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
import type {CompositeInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import type {InjectionConfig, SsiConfigResult} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
import type {EnvOps} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env-merge'
import type {LanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {ManagedTracerConfig, TracerArtifacts} from '@datadog/datadog-ci-base/helpers/serverless/ssi/recognition'

import {DD_TAGS_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  getInjectionMountPath,
  resolveInjectionConfig,
  selectApplicationContainer as selectContainer,
  SsiConfigError,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
import {
  SSI_INJECTION_MODE_TAG,
  TRACER_CONTAINER_NAME,
  TRACER_COPY_ENTRYPOINT,
  TRACER_MOUNT_PATH,
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

export {SsiConfigError} from '@datadog/datadog-ci-base/helpers/serverless/ssi/config'
export type {SsiConfigResult}

export const CONTAINER_APP_TRACER_REGISTRY = 'datadoghq.azurecr.io' as const

const INJECTION_ENV_GROUPS = getInjectionEnvGroups(CONTAINER_APP_TRACER_REGISTRY)
const MANAGED_TRACER_MOUNT_PATHS = getManagedTracerMountPaths(CONTAINER_APP_TRACER_REGISTRY)

const EPHEMERAL_STORAGE_TIERS = [
  {maximumCpu: 0.25, storageGiB: 1},
  {maximumCpu: 0.5, storageGiB: 2},
  {maximumCpu: 1, storageGiB: 4},
] as const

/** Resolves Container Apps tracer inputs before any remote work. */
export const resolveSsiConfig = (config: ContainerAppConfigOptions): SsiConfigResult => {
  const resolved = resolveInjectionConfig(config, {
    registry: CONTAINER_APP_TRACER_REGISTRY,
    languageAliases: {dotnet: 'csharp'},
  })
  if (resolved.kind !== 'single-language' && resolved.kind !== 'multi-language') {
    return resolved
  }

  const collisionErrors = getResourceCollisionErrors(config, getInjectionMountPath(resolved))

  return collisionErrors.length > 0 ? {kind: 'errors', errors: collisionErrors, warnings: []} : resolved
}

/** Selects one application container by stable index. */
export const selectApplicationContainer = (
  containers: readonly Container[],
  sidecarName: string,
  requestedName: string | undefined
): number =>
  selectContainer(containers, requestedName, {
    reservedNames: new Set([sidecarName]),
    noCandidatesHint:
      'Add an application container, or choose a different --sidecar-name if it matches your application container.',
  })

export const assertInjectionEnvCanBeMerged = (
  env: readonly EnvironmentVar[] | undefined,
  config: InjectionConfig
): void =>
  assertFragmentsCanBeMerged(
    env ?? [],
    config.spec.env,
    config.kind === 'single-language' ? [DD_TAGS_ENV_VAR] : [],
    envOps(env)
  )

export const getReplicaEphemeralStorageGiB = (containers: readonly Container[]): number => {
  const totalCpu = containers.reduce((total, container) => total + (container.resources?.cpu ?? 0), 0)

  return EPHEMERAL_STORAGE_TIERS.find(({maximumCpu}) => totalCpu <= maximumCpu)?.storageGiB ?? 8
}

export const assertSsiEphemeralStorage = (containers: readonly Container[], config: InjectionConfig): void => {
  const storageGiB = getReplicaEphemeralStorageGiB(containers)
  const requiredStorageGiB = config.kind === 'single-language' ? 1 : 2

  if (storageGiB < requiredStorageGiB) {
    throw new SsiConfigError(
      `Automatic tracer injection requires at least ${requiredStorageGiB} GiB of replica ephemeral storage, but the final configuration provides the ${storageGiB}-GiB tier. Increase application or Datadog sidecar CPU so their combined CPU exceeds 0.25 vCPU.`
    )
  }
}

export const mergeLanguageInjectionEnv = (
  existingEnv: readonly EnvironmentVar[] | undefined,
  spec: LanguageInjectionSpec
): EnvironmentVar[] => {
  const ops = envOps(existingEnv)
  const merged = mergeFragments(existingEnv ?? [], spec.env, [DD_TAGS_ENV_VAR], ops)
  const existingTags = findEnv(merged, DD_TAGS_ENV_VAR, ops)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value), ops)
}

export const mergeCompositeInjectionEnv = (
  existingEnv: readonly EnvironmentVar[] | undefined,
  spec: CompositeInjectionSpec
): EnvironmentVar[] => mergeFragments(existingEnv ?? [], spec.env, [], envOps(existingEnv))

/** Removes the tracer startup environment of every supported injection mode. */
export const removeInjectionEnv = (existingEnv: readonly EnvironmentVar[] | undefined): EnvironmentVar[] =>
  removeFragmentGroups(existingEnv ?? [], INJECTION_ENV_GROUPS, envOps(existingEnv))

export const hasSsiMarker = (containerApp: ContainerApp): boolean =>
  (containerApp.tags !== undefined &&
    Object.prototype.hasOwnProperty.call(containerApp.tags, SSI_INJECTION_MODE_TAG)) ||
  (containerApp.template?.containers ?? []).some((container) =>
    hasInjectionModeTag(findEnv(container.env ?? [], DD_TAGS_ENV_VAR, envOps(container.env))?.value)
  )

/**
 * Whether the Container App carries instrumentation this command would have written.
 *
 * Only used to tell the customer that an omitted `--tracing` is about to remove their injected
 * tracer. Cleanup never consults it: it runs over the Datadog-owned names unconditionally.
 */
export const hasSsi = (containerApp: ContainerApp): boolean =>
  hasSsiMarker(containerApp) ||
  (containerApp.template?.containers ?? []).some((_, index) => hasCompleteSsiSignature(containerApp, index))

export const hasCompleteSsiSignature = (containerApp: ContainerApp, targetIndex: number): boolean => {
  const target = containerApp.template?.containers?.[targetIndex]
  if (!target) {
    return false
  }

  const injected = getInjectedTracer(tracerArtifacts(containerApp), targetIndex)

  return (
    injected !== undefined &&
    injected.envVariants.some((fragments) => hasAllFragments(target.env ?? [], fragments, envOps(target.env)))
  )
}

/**
 * Whether the Container App declares anything under a name instrumentation owns.
 *
 * Paired with {@link hasSsi} to tell the customer that their own `datadog-tracer` init container or
 * volume is being replaced, rather than removing it silently.
 */
export const hasManagedTracerNames = (containerApp: ContainerApp): boolean =>
  (containerApp.template?.initContainers ?? []).some(({name}) => name === TRACER_CONTAINER_NAME) ||
  (containerApp.template?.volumes ?? []).some(({name}) => name === TRACER_VOLUME_NAME)

const tracerArtifacts = (containerApp: ContainerApp): TracerArtifacts => {
  const template = containerApp.template

  return {
    // Init containers live in their own list, so none of their mounts can be mistaken for the
    // application container's.
    tracers: (template?.initContainers ?? [])
      .map(managedInitConfig)
      .filter((config): config is ManagedTracerConfig => config !== undefined),
    volumeCount: (template?.volumes ?? []).filter(
      ({name, storageType}) => name === TRACER_VOLUME_NAME && storageType === 'EmptyDir'
    ).length,
    mounts: (template?.containers ?? []).flatMap((container, index) =>
      (container.volumeMounts ?? [])
        .filter(({volumeName}) => volumeName === TRACER_VOLUME_NAME)
        .map(({mountPath}) => ({index, path: mountPath ?? ''}))
    ),
  }
}

/**
 * The Container App with every tracer artifact instrumentation owns removed.
 *
 * Ownership is the deterministic names and the tracer mount paths, not a judgement about who wrote
 * them, so this also clears state an older release or another tool left behind. A tracer installed
 * in the application image names none of those, so it survives.
 */
export const removeSsiState = (containerApp: ContainerApp): ContainerApp => {
  const template = containerApp.template
  const initContainers = template?.initContainers?.filter(({name}) => name !== TRACER_CONTAINER_NAME)
  const volumes = template?.volumes?.filter(({name}) => name !== TRACER_VOLUME_NAME)
  const containers = template?.containers?.map((container) => {
    const env = removeInjectionEnv(container.env)
    const volumeMounts = container.volumeMounts?.filter(
      ({volumeName, mountPath}) => volumeName !== TRACER_VOLUME_NAME && !MANAGED_TRACER_MOUNT_PATHS.has(mountPath ?? '')
    )
    const envChanged =
      env.length !== (container.env?.length ?? 0) || env.some((variable, index) => variable !== container.env?.[index])
    const mountsChanged = volumeMounts?.length !== container.volumeMounts?.length

    return envChanged || mountsChanged
      ? {...container, ...(envChanged ? {env} : {}), ...(mountsChanged ? {volumeMounts} : {})}
      : container
  })
  const containersChanged = containers?.some((container, index) => container !== template?.containers?.[index])

  return {
    ...containerApp,
    ...(template === undefined
      ? {}
      : {
          template: {
            ...template,
            ...(initContainers?.length !== template.initContainers?.length ? {initContainers} : {}),
            ...(containersChanged ? {containers} : {}),
            ...(volumes?.length !== template.volumes?.length ? {volumes} : {}),
          },
        }),
  }
}

export const applySsi = (containerApp: ContainerApp, targetIndex: number, config: InjectionConfig): ContainerApp => {
  const mountPath = getInjectionMountPath(config)

  return {
    ...containerApp,
    template: {
      ...containerApp.template,
      initContainers: [
        ...(containerApp.template?.initContainers ?? []),
        buildTracerInitContainer(config.spec.image, mountPath),
      ],
      containers: (containerApp.template?.containers ?? []).map((container, index) =>
        index === targetIndex
          ? {
              ...container,
              env:
                config.kind === 'single-language'
                  ? mergeLanguageInjectionEnv(container.env, config.spec)
                  : mergeCompositeInjectionEnv(container.env, config.spec),
              volumeMounts: [...(container.volumeMounts ?? []), {volumeName: TRACER_VOLUME_NAME, mountPath}],
            }
          : container
      ),
      volumes: [...(containerApp.template?.volumes ?? []), {name: TRACER_VOLUME_NAME, storageType: 'EmptyDir'}],
    },
  }
}

const getResourceCollisionErrors = (config: ContainerAppConfigOptions, mountPath: string): string[] =>
  [
    config.sharedVolumeName === TRACER_VOLUME_NAME
      ? `--shared-volume-name cannot be '${TRACER_VOLUME_NAME}' with --tracing inject. Choose a different logging volume name.`
      : undefined,
    config.sharedVolumePath === mountPath
      ? `--shared-volume-path cannot be '${mountPath}' with --tracing inject. Choose a different logging volume path.`
      : undefined,
  ].filter((error): error is string => error !== undefined)

const managedInitConfig = (container: InitContainer): ManagedTracerConfig | undefined => {
  const config = getManagedTracerConfig(container.image, CONTAINER_APP_TRACER_REGISTRY)

  return config !== undefined && hasManagedInitContainerShape(container, config.mountPath) ? config : undefined
}

const hasManagedInitContainerShape = (container: InitContainer, mountPath: string): boolean =>
  container.name === TRACER_CONTAINER_NAME &&
  container.command?.length === 1 &&
  container.command[0] === TRACER_COPY_ENTRYPOINT &&
  container.args?.length === 1 &&
  container.args[0] === mountPath &&
  container.resources?.cpu === 0.25 &&
  container.resources.memory === '0.5Gi' &&
  container.volumeMounts?.length === 1 &&
  container.volumeMounts.some(
    ({volumeName, mountPath: existingPath}) => volumeName === TRACER_VOLUME_NAME && existingPath === mountPath
  )

const buildTracerInitContainer = (image: string, mountPath: string): InitContainer => ({
  name: TRACER_CONTAINER_NAME,
  image,
  command: [TRACER_COPY_ENTRYPOINT],
  args: [mountPath],
  resources: {cpu: 0.25, memory: '0.5Gi'},
  volumeMounts: [{volumeName: TRACER_VOLUME_NAME, mountPath}],
})

/** A secret-backed variable carries no literal value to merge into. */
const envOps = (env: readonly EnvironmentVar[] | undefined): EnvOps<EnvironmentVar> => ({
  matches: (variable, name) => variable.name === name,
  valueOf: (variable) => (variable.name && !variable.secretRef ? variable.value : undefined),
  isSecretBacked: (name) => (env ?? []).some((variable) => variable.name === name && variable.secretRef !== undefined),
  create: (name, value) => ({name, value}),
  withValue: (variable, value) => ({...variable, value}),
})
