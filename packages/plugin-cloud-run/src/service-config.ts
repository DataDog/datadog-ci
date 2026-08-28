import type {SsiConfigResult} from './ssi'
import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'
import type {TracerVolumeMedium} from '@datadog/datadog-ci-base/commands/cloud-run/constants'

import {createInstrumentedTemplate} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DD_TRACE_ENABLED_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  DEFAULT_HEALTH_CHECK_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_READINESS_PORT,
  TRACER_VOLUME_NAME,
  TRACER_VOLUME_SIZE_LIMIT,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {getTracerCopyCompletionMarker} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

import {
  assertInjectionEnvCanBeMerged,
  COMPOSITE_TRACER_COMPLETION_MARKER,
  COMPOSITE_TRACER_IMAGE,
  COMPOSITE_TRACER_MOUNT_PATH,
  mergeCompositeInjectionEnv,
  mergeLanguageInjectionEnv,
  removeCompositeInjectionEnv,
  removeInjectionEnv,
  removeSingleLanguageInjectionEnv,
  selectMainContainer,
  SsiConfigError,
} from './ssi'

type EmptyDirMedium = NonNullable<NonNullable<IVolume['emptyDir']>['medium']>

const MEMORY_VOLUME_MEDIUM = 1 as const // google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const DISK_VOLUME_MEDIUM = 2 as EmptyDirMedium // Cloud Run API DISK; the installed SDK enum has not caught up.
const DISK_VOLUME_SIZE_LIMIT = '10Gi'
const GEN2_EXECUTION_ENVIRONMENT = 2 as const // google.cloud.run.v2.ExecutionEnvironment.EXECUTION_ENVIRONMENT_GEN2
const SSI_INJECTION_MODE_LABEL = 'dd_sls_injection_mode'
const SINGLE_LANGUAGE_SSI_MODE = 'single_language'
const LEGACY_TRACER_CONTAINER_NAME = 'datadog-tracer-copy'
const MANAGED_TRACER_CONTAINER_NAMES = new Set([TRACER_CONTAINER_NAME, LEGACY_TRACER_CONTAINER_NAME])
const MULTI_LANGUAGE_SSI_MODE = 'multi_language'
type OwnedSsiMode = typeof SINGLE_LANGUAGE_SSI_MODE | typeof MULTI_LANGUAGE_SSI_MODE
const MULTI_LANGUAGE_VOLUME_SIZE_LIMIT = '1.5Gi'
const MULTI_LANGUAGE_TRACER_MEMORY_LIMIT = '2Gi'
const UNIFIED_SERVICE_TAG_LABELS = {
  service: 'service',
  environment: 'env',
  version: 'version',
} as const
const INSTRUMENTATION_LABELS = new Set([
  ...Object.values(UNIFIED_SERVICE_TAG_LABELS),
  SERVERLESS_CLI_VERSION_TAG_NAME,
  SSI_INJECTION_MODE_LABEL,
])

export interface InstrumentServiceConfigOptions {
  readonly ssiConfig?: SsiConfigResult
  readonly ddService: string
  readonly environment: string | undefined
  readonly version: string | undefined
  readonly envVarsByName: Readonly<Record<string, IEnvVar>>
  readonly healthCheckPort: number | undefined
  readonly tracerReadinessPort?: number
  readonly sidecarName: string
  readonly sidecarImage: string
  readonly sidecarCpus: string
  readonly sidecarMemory: string
  readonly sharedVolumeName: string
  readonly sharedVolumePath: string
}

interface UninstrumentServiceConfigOptions {
  readonly sidecarName: string
  readonly sharedVolumeName: string
  readonly envVarNames: ReadonlySet<string>
}

interface UninstrumentServiceConfigResult {
  readonly service: IService
  readonly sidecarRemoved: boolean
  readonly sharedVolumeRemoved: boolean
}

export const instrumentServiceConfig = (service: IService, options: InstrumentServiceConfigOptions): IService => {
  const ssiConfig = options.ssiConfig ?? {kind: 'no-injection', tracing: undefined, warnings: []}
  if (ssiConfig.kind === 'errors') {
    throw new SsiConfigError(ssiConfig.errors.join('\n'))
  }
  const tracerReadinessPort = options.tracerReadinessPort ?? TRACER_READINESS_PORT

  let sourceTemplate: IServiceTemplate = service.template || {}
  let targetContainers: ReadonlySet<IContainer> | undefined
  const healthCheckPort = resolveHealthCheckPort(sourceTemplate, options)
  const envVarsByName: Record<string, IEnvVar> = {
    ...options.envVarsByName,
    [HEALTH_PORT_ENV_VAR]: {name: HEALTH_PORT_ENV_VAR, value: String(healthCheckPort)},
  }
  const existingSsiMode = getOwnedSsiMode(service.labels?.[SSI_INJECTION_MODE_LABEL])
  const sourceContainers = sourceTemplate.containers ?? []
  const hasTracerContainer = sourceContainers.some(isManagedTracerContainer)
  const hasTracerVolume = sourceTemplate.volumes?.some((volume) => volume.name === TRACER_VOLUME_NAME) ?? false
  const shouldRemoveSsi =
    existingSsiMode !== undefined && ssiConfig.kind === 'no-injection' && ssiConfig.tracing !== undefined

  if (shouldRemoveSsi) {
    const mainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      new Set([options.sidecarName, TRACER_CONTAINER_NAME])
    )
    sourceTemplate = removeExistingSsiState(sourceTemplate, mainContainer, existingSsiMode)
  } else if (ssiConfig.kind === 'no-injection') {
    if (hasTracerContainer) {
      targetContainers = new Set(
        sourceContainers.filter(
          (container) => container.name !== options.sidecarName && !isManagedTracerContainer(container)
        )
      )
    }
  } else {
    if (!hasSsi && (hasTracerContainer || hasTracerVolume)) {
      const resources = [hasTracerContainer ? 'container' : undefined, hasTracerVolume ? 'volume' : undefined].filter(
        (resource): resource is string => resource !== undefined
      )
      throw new SsiConfigError(
        `Cannot enable automatic instrumentation because the service already has a ${resources.join(
          ' and '
        )} named '${TRACER_CONTAINER_NAME}' that is not managed by datadog-ci. Rename the existing ${
          resources.length === 1 ? resources[0] : 'resources'
        }, then retry.`
      )
    }
    const mainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      reservedContainerNames(options.sidecarName)
    )
    assertTracerReadinessPortAvailable(mainContainer, options.sidecarName, tracerReadinessPort, healthCheckPort)
    if (!hasSsi) {
      assertTracerMountPathAvailable(mainContainer)
    }
    sourceTemplate =
      existingSsiMode !== undefined || hasTracerContainer
        ? removeExistingSsiState(sourceTemplate, mainContainer, existingSsiMode)
        : sourceTemplate
    const updatedMainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      reservedContainerNames(options.sidecarName)
    )
    assertInjectionEnvCanBeMerged(updatedMainContainer.env, ssiConfig)
    targetContainers = new Set([updatedMainContainer])
    envVarsByName[DD_TRACE_ENABLED_ENV_VAR] = {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'}
  }

  let template = createInstrumentedTemplate(
    sourceTemplate,
    buildSidecarContainer(sourceTemplate, options, healthCheckPort),
    {
      name: options.sharedVolumeName,
      mountPath: options.sharedVolumePath,
      mountOptions: {emptyDir: {medium: MEMORY_VOLUME_MEDIUM}},
      volumeMountNameKey: 'name',
    },
    envVarsByName,
    targetContainers
  ) as IServiceTemplate
  const labels: Record<string, string> = {
    ...service.labels,
    [UNIFIED_SERVICE_TAG_LABELS.service]: options.ddService,
    [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE.replace(/\./g, '_'),
  }
  if (options.environment) {
    labels[UNIFIED_SERVICE_TAG_LABELS.environment] = options.environment
  }
  if (options.version) {
    labels[UNIFIED_SERVICE_TAG_LABELS.version] = options.version
  }

  if (shouldRemoveSsi) {
    delete labels[SSI_INJECTION_MODE_LABEL]
  }

  if (ssiConfig.kind === 'single-language' || ssiConfig.kind === 'multi-language') {
    const mainContainer = selectMainContainer(template.containers ?? [], reservedContainerNames(options.sidecarName))
    const isMultiLanguage = ssiConfig.kind === 'multi-language'
    const mountPath = isMultiLanguage ? COMPOSITE_TRACER_MOUNT_PATH : TRACER_MOUNT_PATH
    const configuredMainContainer = {
      ...mainContainer,
      env: isMultiLanguage
        ? mergeCompositeInjectionEnv(mainContainer.env)
        : mergeLanguageInjectionEnv(mainContainer.env, ssiConfig.spec),
    }
    template = {
      ...template,
      containers: template.containers?.map((container) =>
        container === mainContainer ? configuredMainContainer : container
      ),
    }
    template = applyTracerContainer(
      template,
      {
        image: isMultiLanguage ? COMPOSITE_TRACER_IMAGE : ssiConfig.spec.image,
        completionMarker: isMultiLanguage
          ? COMPOSITE_TRACER_COMPLETION_MARKER
          : getTracerCopyCompletionMarker(ssiConfig.language, TRACER_MOUNT_PATH),
        mountPath,
        readinessPort: tracerReadinessPort,
        tracerVolumeMedium: ssiConfig.tracerVolumeMedium,
        memoryVolumeSize: isMultiLanguage ? MULTI_LANGUAGE_VOLUME_SIZE_LIMIT : TRACER_VOLUME_SIZE_LIMIT,
        memoryLimit:
          isMultiLanguage && ssiConfig.tracerVolumeMedium === 'memory' ? MULTI_LANGUAGE_TRACER_MEMORY_LIMIT : undefined,
      },
      configuredMainContainer,
      [options.sidecarName]
    )
    labels[SSI_INJECTION_MODE_LABEL] = isMultiLanguage ? MULTI_LANGUAGE_SSI_MODE : SINGLE_LANGUAGE_SSI_MODE
  }

  const usesDiskTracerVolume =
    (ssiConfig.kind === 'single-language' || ssiConfig.kind === 'multi-language') &&
    ssiConfig.tracerVolumeMedium === 'disk'

  return {
    ...service,
    ...(usesDiskTracerVolume ? {launchStage: atLeastBetaLaunchStage(service.launchStage)} : {}),
    labels,
    template: {
      ...template,
      ...(usesDiskTracerVolume ? {executionEnvironment: GEN2_EXECUTION_ENVIRONMENT} : {}),
      revision: undefined,
    },
  }
}

export const uninstrumentServiceConfig = (
  service: IService,
  options: UninstrumentServiceConfigOptions
): UninstrumentServiceConfigResult => {
  const template: IServiceTemplate = service.template || {}
  const containers: IContainer[] = template.containers || []
  const volumes: IVolume[] = template.volumes || []
  const sidecarRemoved = containers.some((container) => container.name === options.sidecarName)
  const sharedVolumeRemoved = volumes.some((volume) => volume.name === options.sharedVolumeName)
  const updatedContainers = containers
    .filter((container) => container.name !== options.sidecarName && container.name !== TRACER_CONTAINER_NAME)
    .map((container) =>
      removeContainerInstrumentation(container, options.sidecarName, options.sharedVolumeName, options.envVarNames)
    )
  const updatedVolumes = volumes.filter(
    (volume) => volume.name !== options.sharedVolumeName && volume.name !== TRACER_VOLUME_NAME
  )
  const labels = Object.fromEntries(
    Object.entries(service.labels ?? {}).filter(([name]) => !INSTRUMENTATION_LABELS.has(name))
  )

  return {
    service: {
      ...service,
      labels,
      template: {
        ...template,
        containers: updatedContainers,
        volumes: updatedVolumes,
        revision: undefined,
      },
    },
    sidecarRemoved,
    sharedVolumeRemoved,
  }
}

const TRACER_RUNTIME_SCRIPT = [
  'set -e',
  '/datadog-init/copy-lib.sh "$1"',
  '[ -f "$2" ]',
  'exec /datadog-init/probe-server "$3"',
].join('\n')

interface TracerContainerConfig {
  image: string
  completionMarker: string
  mountPath: string
  readinessPort: number
  tracerVolumeMedium: TracerVolumeMedium
  memoryVolumeSize: string
  memoryLimit: string | undefined
}

const buildTracerContainer = (config: TracerContainerConfig): IContainer => ({
  name: TRACER_CONTAINER_NAME,
  image: config.image,
  command: ['/bin/sh'],
  args: [
    '-c',
    TRACER_RUNTIME_SCRIPT,
    TRACER_CONTAINER_NAME,
    config.mountPath,
    config.completionMarker,
    String(config.readinessPort),
  ],
  volumeMounts: [{name: TRACER_VOLUME_NAME, mountPath: config.mountPath}],
  ...(config.memoryLimit ? {resources: {limits: {memory: config.memoryLimit}}} : {}),
  startupProbe: {
    tcpSocket: {port: config.readinessPort},
    initialDelaySeconds: 0,
    // Poll every 5 seconds (48 times) for Cloud Run's maximum 240-second startup window.
    periodSeconds: 5,
    failureThreshold: 48,
    timeoutSeconds: 1,
  },
})

const applyTracerContainer = (
  template: IServiceTemplate,
  config: TracerContainerConfig,
  mainContainer: IContainer,
  dependencyNames: readonly string[]
): IServiceTemplate => {
  const managedDependencies = new Set([...MANAGED_TRACER_CONTAINER_NAMES, ...dependencyNames])
  const containers = (template.containers ?? []).map((container) =>
    container === mainContainer
      ? {
          ...container,
          volumeMounts: [
            ...(container.volumeMounts ?? []).filter((mount) => mount.name !== TRACER_VOLUME_NAME),
            {name: TRACER_VOLUME_NAME, mountPath: config.mountPath},
          ],
          dependsOn: [
            ...(container.dependsOn ?? []).filter((name) => !managedDependencies.has(name)),
            TRACER_CONTAINER_NAME,
            ...dependencyNames,
          ],
        }
      : container
  )

  containers.push(buildTracerContainer(config))

  return {
    ...template,
    containers,
    volumes: [
      ...(template.volumes ?? []),
      {
        name: TRACER_VOLUME_NAME,
        emptyDir: tracerVolumeConfig(config.tracerVolumeMedium, config.memoryVolumeSize),
      },
    ],
  }
}

const tracerVolumeConfig = (medium: TracerVolumeMedium, memorySize: string) =>
  medium === 'disk'
    ? {medium: DISK_VOLUME_MEDIUM, sizeLimit: DISK_VOLUME_SIZE_LIMIT}
    : {medium: MEMORY_VOLUME_MEDIUM, sizeLimit: memorySize}

const atLeastBetaLaunchStage = (launchStage: IService['launchStage']) =>
  launchStage === 'ALPHA' ? launchStage : 'BETA'

const assertTracerMountPathAvailable = (mainContainer: IContainer): void => {
  const existingMount = mainContainer.volumeMounts?.find((mount) => mount.mountPath === TRACER_MOUNT_PATH)
  if (existingMount) {
    throw new SsiConfigError(
      `Cannot enable automatic instrumentation because volume '${
        existingMount.name || '<unnamed>'
      }' already uses managed tracer mount path '${TRACER_MOUNT_PATH}' on container '${
        mainContainer.name || '<unnamed>'
      }'. Change the existing mount path, then retry.`
    )
  }
}

const assertTracerReadinessPortAvailable = (
  mainContainer: IContainer,
  sidecarName: string,
  tracerReadinessPort: number,
  healthCheckPort: number
): void => {
  if (mainContainer.ports?.some(({containerPort}) => containerPort === tracerReadinessPort)) {
    const containerName = mainContainer.name || '<unnamed>'
    throw new SsiConfigError(
      `--tracer-readiness-port ${tracerReadinessPort} conflicts with port ${tracerReadinessPort} on container '${containerName}'. Change --tracer-readiness-port or container '${containerName}' port.`
    )
  }

  if (healthCheckPort === tracerReadinessPort) {
    const containerName = sidecarName || '<unnamed>'
    throw new SsiConfigError(
      `--tracer-readiness-port ${tracerReadinessPort} conflicts with Datadog Agent health port ${healthCheckPort} for container '${containerName}'. Change --tracer-readiness-port or --health-check-port.`
    )
  }
}

const getOwnedSsiMode = (mode: string | undefined): OwnedSsiMode | undefined => {
  if (mode === SINGLE_LANGUAGE_SSI_MODE || mode === MULTI_LANGUAGE_SSI_MODE) {
    return mode
  }
}

const removeExistingSsiState = (
  template: IServiceTemplate,
  mainContainer?: IContainer,
  mode?: OwnedSsiMode
): IServiceTemplate => ({
  ...template,
  containers: (template.containers ?? [])
    .filter((container) => !isManagedTracerContainer(container))
    .map((container) =>
      removeExistingSsiContainer(
        container,
        mainContainer === undefined
          ? (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
          : container === mainContainer,
        mode
      )
    ),
  volumes: (template.volumes ?? []).filter((volume) => volume.name !== TRACER_VOLUME_NAME),
})

const removeExistingSsiContainer = (
  container: IContainer,
  isMainContainer: boolean,
  mode?: OwnedSsiMode
): IContainer => {
  const existingEnv = container.env ?? []
  const env = isMainContainer ? removeSsiEnv(existingEnv, mode) : existingEnv
  const envChanged = env.length !== existingEnv.length || env.some((variable, index) => variable !== existingEnv[index])
  const existingMounts = container.volumeMounts ?? []
  const volumeMounts = existingMounts.filter((mount) => mount.name !== TRACER_VOLUME_NAME)

  let cleaned = container
  if (envChanged) {
    cleaned = {...cleaned, env}
  }
  if (volumeMounts.length !== existingMounts.length) {
    cleaned = {...cleaned, volumeMounts}
  }

  return removeDependencies(cleaned, MANAGED_TRACER_CONTAINER_NAMES)
}

const removeSsiEnv = (env: readonly IEnvVar[], mode: OwnedSsiMode | undefined): IEnvVar[] => {
  switch (mode) {
    case SINGLE_LANGUAGE_SSI_MODE:
      return removeSingleLanguageInjectionEnv(env)
    case MULTI_LANGUAGE_SSI_MODE:
      return removeCompositeInjectionEnv(env)
    default:
      return removeInjectionEnv(env)
  }
}

const isManagedTracerContainer = (container: IContainer): boolean =>
  typeof container.name === 'string' && MANAGED_TRACER_CONTAINER_NAMES.has(container.name)

const reservedContainerNames = (sidecarName: string): ReadonlySet<string> =>
  new Set([sidecarName, ...MANAGED_TRACER_CONTAINER_NAMES])

const removeDependencies = (container: IContainer, names: ReadonlySet<string>): IContainer =>
  [...names].reduce((updated, name) => removeDependency(updated, name), container)

const removeDependency = (container: IContainer, name: string): IContainer => {
  if (!container.dependsOn?.includes(name)) {
    return container
  }
  const dependsOn = container.dependsOn.filter((dependency) => dependency !== name)
  if (dependsOn.length === 0) {
    const {dependsOn: _removed, ...updated} = container

    return updated
  }

  return {...container, dependsOn}
}

const buildSidecarContainer = (
  template: IServiceTemplate,
  options: InstrumentServiceConfigOptions,
  healthCheckPort: number
): IContainer => {
  const existingSidecar = template.containers?.find((container) => container.name === options.sidecarName)

  return {
    ...existingSidecar,
    name: options.sidecarName,
    image: options.sidecarImage,
    startupProbe: {
      tcpSocket: {port: healthCheckPort},
      initialDelaySeconds: 0,
      periodSeconds: 10,
      failureThreshold: 3,
      timeoutSeconds: 1,
    },
    resources: {
      limits: {
        memory: options.sidecarMemory,
        cpu: options.sidecarCpus,
      },
    },
  }
}

const resolveHealthCheckPort = (template: IServiceTemplate, options: InstrumentServiceConfigOptions): number => {
  const existingSidecar = template.containers?.find((container) => container.name === options.sidecarName)
  const port = Number(
    options.healthCheckPort ?? existingSidecar?.env?.find(({name}) => name === HEALTH_PORT_ENV_VAR)?.value
  )

  return Number.isNaN(port) ? DEFAULT_HEALTH_CHECK_PORT : port
}

const removeContainerInstrumentation = (
  container: IContainer,
  agentContainerName: string,
  sharedVolumeName: string,
  envVarNames: ReadonlySet<string>
): IContainer => {
  const withoutSsi = removeExistingSsiContainer(container, true)
  const updated = removeDependency(withoutSsi, agentContainerName)

  return {
    ...updated,
    volumeMounts: (updated.volumeMounts || []).filter((volumeMount) => volumeMount.name !== sharedVolumeName),
    env: (updated.env || []).filter(
      (envVar) => envVar.name && !envVar.name.startsWith('DD_') && !envVarNames.has(envVar.name)
    ),
  }
}
