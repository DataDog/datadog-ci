import type {SsiConfigResult} from './ssi'
import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'

import {createInstrumentedTemplate} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DD_TRACE_ENABLED_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  DEFAULT_HEALTH_CHECK_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  TRACER_COPY_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_READINESS_PORT,
  TRACER_VOLUME_NAME,
  TRACER_VOLUME_SIZE_LIMIT,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {getTracerCopyCompletionMarker} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

import {mergeLanguageInjectionEnv, removeLanguageInjectionEnv, selectMainContainer, SsiConfigError} from './ssi'

const MEMORY_VOLUME_MEDIUM = 1 as const // google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const SSI_INJECTION_MODE_LABEL = 'dd_sls_injection_mode'
const SINGLE_LANGUAGE_SSI_MODE = 'single_language'
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
  readonly healthCheckPort: string | undefined
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
  const envVarsByName = {...options.envVarsByName}
  const hasSsi = service.labels?.[SSI_INJECTION_MODE_LABEL] === SINGLE_LANGUAGE_SSI_MODE
  const shouldRemoveSsi = hasSsi && ssiConfig.kind === 'no-injection' && ssiConfig.tracing !== undefined

  if (shouldRemoveSsi) {
    sourceTemplate = removeExistingSsiState(sourceTemplate)
  } else if (ssiConfig.kind === 'no-injection') {
    if (sourceTemplate.containers?.some((container) => container.name === TRACER_COPY_CONTAINER_NAME)) {
      targetContainers = new Set(
        sourceTemplate.containers.filter(
          (container) => container.name !== options.sidecarName && container.name !== TRACER_COPY_CONTAINER_NAME
        )
      )
    }
  } else {
    const mainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      new Set([options.sidecarName, TRACER_COPY_CONTAINER_NAME])
    )
    assertTracerReadinessPortAvailable(sourceTemplate, mainContainer, options, tracerReadinessPort)
    sourceTemplate = hasSsi ? removeExistingSsiState(sourceTemplate, mainContainer) : sourceTemplate
    const updatedMainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      new Set([options.sidecarName, TRACER_COPY_CONTAINER_NAME])
    )
    targetContainers = new Set([updatedMainContainer])
    envVarsByName[DD_TRACE_ENABLED_ENV_VAR] = {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'}
  }

  let template = createInstrumentedTemplate(
    sourceTemplate,
    buildSidecarContainer(sourceTemplate, options),
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

  if (ssiConfig.kind === 'single-language') {
    const mainContainer = selectMainContainer(
      template.containers ?? [],
      new Set([options.sidecarName, TRACER_COPY_CONTAINER_NAME])
    )
    const configuredMainContainer = {
      ...mainContainer,
      env: mergeLanguageInjectionEnv(mainContainer.env, ssiConfig.spec),
    }
    template = {
      ...template,
      containers: template.containers?.map((container) =>
        container === mainContainer ? configuredMainContainer : container
      ),
    }
    template = applyTracerCopy(
      template,
      {
        image: ssiConfig.spec.image,
        completionMarker: getTracerCopyCompletionMarker(ssiConfig.language, TRACER_MOUNT_PATH),
        readinessPort: tracerReadinessPort,
      },
      configuredMainContainer,
      [options.sidecarName]
    )
    labels[SSI_INJECTION_MODE_LABEL] = SINGLE_LANGUAGE_SSI_MODE
  }

  return {...service, labels, template: {...template, revision: undefined}}
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
  const hasSsi = service.labels?.[SSI_INJECTION_MODE_LABEL] === SINGLE_LANGUAGE_SSI_MODE
  const updatedContainers = containers
    .filter(
      (container) =>
        container.name !== options.sidecarName && (!hasSsi || container.name !== TRACER_COPY_CONTAINER_NAME)
    )
    .map((container) =>
      removeContainerInstrumentation(
        container,
        options.sidecarName,
        options.sharedVolumeName,
        options.envVarNames,
        hasSsi
      )
    )
  const updatedVolumes = volumes.filter(
    (volume) => volume.name !== options.sharedVolumeName && (!hasSsi || volume.name !== TRACER_VOLUME_NAME)
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

const TRACER_COPY_SCRIPT = [
  'set -e',
  '/datadog-init/copy-lib.sh "$1"',
  '[ -f "$2" ]',
  'exec /datadog-init/probe-server "$3"',
].join('\n')

interface TracerCopyConfig {
  image: string
  completionMarker: string
  readinessPort: number
}

const buildTracerCopyContainer = (config: TracerCopyConfig): IContainer => ({
  name: TRACER_COPY_CONTAINER_NAME,
  image: config.image,
  command: ['/bin/sh'],
  args: [
    '-c',
    TRACER_COPY_SCRIPT,
    TRACER_COPY_CONTAINER_NAME,
    TRACER_MOUNT_PATH,
    config.completionMarker,
    String(config.readinessPort),
  ],
  volumeMounts: [{name: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH}],
  startupProbe: {
    tcpSocket: {port: config.readinessPort},
    initialDelaySeconds: 0,
    periodSeconds: 5,
    failureThreshold: 48,
    timeoutSeconds: 1,
  },
})

const applyTracerCopy = (
  template: IServiceTemplate,
  config: TracerCopyConfig,
  mainContainer: IContainer,
  dependencyNames: readonly string[]
): IServiceTemplate => {
  const managedDependencies = new Set([TRACER_COPY_CONTAINER_NAME, ...dependencyNames])
  const containers = (template.containers ?? []).map((container) =>
    container === mainContainer
      ? {
          ...container,
          volumeMounts: [
            ...(container.volumeMounts ?? []).filter((mount) => mount.name !== TRACER_VOLUME_NAME),
            {name: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH},
          ],
          dependsOn: [
            ...(container.dependsOn ?? []).filter((name) => !managedDependencies.has(name)),
            TRACER_COPY_CONTAINER_NAME,
            ...dependencyNames,
          ],
        }
      : container
  )

  containers.push(buildTracerCopyContainer(config))

  return {
    ...template,
    containers,
    volumes: [
      ...(template.volumes ?? []),
      {
        name: TRACER_VOLUME_NAME,
        emptyDir: {medium: MEMORY_VOLUME_MEDIUM, sizeLimit: TRACER_VOLUME_SIZE_LIMIT},
      },
    ],
  }
}

const assertTracerReadinessPortAvailable = (
  template: IServiceTemplate,
  mainContainer: IContainer,
  options: InstrumentServiceConfigOptions,
  tracerReadinessPort: number
): void => {
  if (mainContainer.ports?.some(({containerPort}) => containerPort === tracerReadinessPort)) {
    const containerName = mainContainer.name || '<unnamed>'
    throw new SsiConfigError(
      `--tracer-readiness-port ${tracerReadinessPort} conflicts with port ${tracerReadinessPort} on container '${containerName}'. Change --tracer-readiness-port or container '${containerName}' port.`
    )
  }

  const healthCheckPort = resolveHealthCheckPort(template, options)
  if (healthCheckPort === tracerReadinessPort) {
    const containerName = options.sidecarName || '<unnamed>'
    throw new SsiConfigError(
      `--tracer-readiness-port ${tracerReadinessPort} conflicts with Datadog Agent health port ${healthCheckPort} for container '${containerName}'. Change --tracer-readiness-port or --health-check-port.`
    )
  }
}

const removeExistingSsiState = (template: IServiceTemplate, mainContainer?: IContainer): IServiceTemplate => ({
  ...template,
  containers: (template.containers ?? [])
    .filter((container) => container.name !== TRACER_COPY_CONTAINER_NAME)
    .map((container) =>
      removeExistingSsiContainer(
        container,
        mainContainer === undefined
          ? (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
          : container === mainContainer
      )
    ),
  volumes: (template.volumes ?? []).filter((volume) => volume.name !== TRACER_VOLUME_NAME),
})

const removeExistingSsiContainer = (container: IContainer, isMainContainer: boolean): IContainer => {
  const existingEnv = container.env ?? []
  const env = isMainContainer ? removeLanguageInjectionEnv(existingEnv) : existingEnv
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

  return removeDependency(cleaned, TRACER_COPY_CONTAINER_NAME)
}

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

const buildSidecarContainer = (template: IServiceTemplate, options: InstrumentServiceConfigOptions): IContainer => {
  const existingSidecar = template.containers?.find((container) => container.name === options.sidecarName)

  return {
    ...existingSidecar,
    name: options.sidecarName,
    image: options.sidecarImage,
    startupProbe: {
      tcpSocket: {port: resolveHealthCheckPort(template, options)},
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
  envVarNames: ReadonlySet<string>,
  hasSsi: boolean
): IContainer => {
  const hasTracerMount = container.volumeMounts?.some((mount) => mount.name === TRACER_VOLUME_NAME) ?? false
  const withoutSsi = hasSsi && hasTracerMount ? removeExistingSsiContainer(container, true) : container
  const updated = removeDependency(withoutSsi, agentContainerName)

  return {
    ...updated,
    volumeMounts: (updated.volumeMounts || []).filter((volumeMount) => volumeMount.name !== sharedVolumeName),
    env: (updated.env || []).filter(
      (envVar) => envVar.name && !envVar.name.startsWith('DD_') && !envVarNames.has(envVar.name)
    ),
  }
}
