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
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {getTracerCopyCompletionMarker} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

import {mergeLanguageInjectionEnv, removeLanguageInjectionEnv, selectMainContainer, SsiConfigError} from './ssi'

const MEMORY_VOLUME_MEDIUM = 1 as const // google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const SSI_ADOPTED_MAIN_CONTAINER_NAME = 'datadog-app'
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

  let sourceTemplate: IServiceTemplate = service.template || {}
  let targetContainerNames: ReadonlySet<string> | undefined
  const envVarsByName = {...options.envVarsByName}
  const ownsSsiState = service.labels?.[SSI_INJECTION_MODE_LABEL] === SINGLE_LANGUAGE_SSI_MODE
  const removesOwnedSsiState = ownsSsiState && ssiConfig.kind === 'no-injection' && ssiConfig.tracing !== undefined

  if (removesOwnedSsiState) {
    sourceTemplate = removeExistingSsiState(sourceTemplate)
  } else if (ssiConfig.kind === 'no-injection') {
    if (sourceTemplate.containers?.some((container) => container.name === TRACER_COPY_CONTAINER_NAME)) {
      targetContainerNames = new Set(
        sourceTemplate.containers
          .filter(
            (container) => container.name !== options.sidecarName && container.name !== TRACER_COPY_CONTAINER_NAME
          )
          .map((container) => container.name ?? '')
      )
    }
  } else {
    assertSsiResourceNamesAvailable(sourceTemplate, options, ownsSsiState)

    const mainContainer = selectMainContainer(
      sourceTemplate.containers ?? [],
      new Set([options.sidecarName, TRACER_COPY_CONTAINER_NAME])
    )
    const namedMainContainer = ensureMainContainerName(sourceTemplate, mainContainer, ownsSsiState)
    sourceTemplate = ownsSsiState
      ? removeExistingSsiState(namedMainContainer.template, namedMainContainer.mainContainerName)
      : namedMainContainer.template
    targetContainerNames = new Set([namedMainContainer.mainContainerName])
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
    targetContainerNames
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

  if (removesOwnedSsiState) {
    delete labels[SSI_INJECTION_MODE_LABEL]
  }

  if (ssiConfig.kind === 'single-language') {
    template = {
      ...template,
      containers: template.containers?.map((container) =>
        targetContainerNames?.has(container.name ?? '')
          ? {...container, env: mergeLanguageInjectionEnv(container.env, ssiConfig.spec)}
          : container
      ),
    }
    template = applyTracerCopy(
      template,
      ssiConfig.spec.image,
      getTracerCopyCompletionMarker(ssiConfig.language, TRACER_MOUNT_PATH),
      [...targetContainerNames!][0],
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
  const ownsSsiState = service.labels?.[SSI_INJECTION_MODE_LABEL] === SINGLE_LANGUAGE_SSI_MODE
  const restoreAdoptedMainContainerName =
    ownsSsiState &&
    containers.some(
      (container) =>
        container.name === SSI_ADOPTED_MAIN_CONTAINER_NAME &&
        (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
    )
  const updatedContainers = containers
    .filter(
      (container) =>
        container.name !== options.sidecarName && (!ownsSsiState || container.name !== TRACER_COPY_CONTAINER_NAME)
    )
    .map((container) =>
      removeContainerInstrumentation(
        container,
        options.sidecarName,
        options.sharedVolumeName,
        options.envVarNames,
        ownsSsiState,
        restoreAdoptedMainContainerName
      )
    )
  const updatedVolumes = volumes.filter(
    (volume) => volume.name !== options.sharedVolumeName && (!ownsSsiState || volume.name !== TRACER_VOLUME_NAME)
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

const buildTracerCopyContainer = (image: string, marker: string): IContainer => ({
  name: TRACER_COPY_CONTAINER_NAME,
  image,
  command: ['/bin/sh'],
  args: [
    '-c',
    TRACER_COPY_SCRIPT,
    TRACER_COPY_CONTAINER_NAME,
    TRACER_MOUNT_PATH,
    marker,
    String(TRACER_READINESS_PORT),
  ],
  volumeMounts: [{name: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH}],
  startupProbe: {
    tcpSocket: {port: TRACER_READINESS_PORT},
    initialDelaySeconds: 0,
    periodSeconds: 5,
    failureThreshold: 48,
    timeoutSeconds: 1,
  },
})

const applyTracerCopy = (
  template: IServiceTemplate,
  image: string,
  marker: string,
  mainContainerName: string,
  dependencyNames: readonly string[]
): IServiceTemplate => {
  const containers = [...(template.containers ?? [])]
  const mainContainerIndex = containers.findIndex((container) => container.name === mainContainerName)
  if (mainContainerIndex === -1) {
    throw new SsiConfigError(`Main container '${mainContainerName}' was not found in the service template.`)
  }

  const mainContainer = containers[mainContainerIndex]
  assertNoDependencyCycle(containers, mainContainerName, [TRACER_COPY_CONTAINER_NAME, ...dependencyNames])
  const managedDependencies = new Set([TRACER_COPY_CONTAINER_NAME, ...dependencyNames])
  containers[mainContainerIndex] = {
    ...mainContainer,
    volumeMounts: [
      ...(mainContainer.volumeMounts ?? []).filter((mount) => mount.name !== TRACER_VOLUME_NAME),
      {name: TRACER_VOLUME_NAME, mountPath: TRACER_MOUNT_PATH},
    ],
    dependsOn: [
      ...(mainContainer.dependsOn ?? []).filter((name) => !managedDependencies.has(name)),
      TRACER_COPY_CONTAINER_NAME,
      ...dependencyNames,
    ],
  }

  containers.push(buildTracerCopyContainer(image, marker))

  return {
    ...template,
    containers,
    volumes: [...(template.volumes ?? []), {name: TRACER_VOLUME_NAME, emptyDir: {medium: MEMORY_VOLUME_MEDIUM}}],
  }
}

const assertNoDependencyCycle = (
  containers: readonly IContainer[],
  mainContainerName: string,
  dependencyNames: readonly string[]
): void => {
  const containersByName = new Map(
    containers.flatMap((container) => (container.name ? [[container.name, container] as const] : []))
  )
  for (const dependencyName of dependencyNames) {
    const pending = [dependencyName]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const name = pending.pop()!
      if (name === mainContainerName) {
        throw new SsiConfigError(
          `Cannot make main container '${mainContainerName}' depend on '${dependencyName}' because that container already depends on the main container directly or transitively.`
        )
      }
      if (!visited.has(name)) {
        visited.add(name)
        pending.push(...(containersByName.get(name)?.dependsOn ?? []))
      }
    }
  }
}

const assertSsiResourceNamesAvailable = (
  template: IServiceTemplate,
  options: InstrumentServiceConfigOptions,
  ownsSsiState: boolean
): void => {
  if (options.sidecarName === TRACER_COPY_CONTAINER_NAME) {
    throw new SsiConfigError(`The Agent sidecar name '${options.sidecarName}' is reserved for tracer injection.`)
  }
  if (options.sharedVolumeName === TRACER_VOLUME_NAME) {
    throw new SsiConfigError(
      `The Agent shared volume name '${options.sharedVolumeName}' is reserved for tracer injection.`
    )
  }
  if (ownsSsiState) {
    return
  }
  if (template.containers?.some((container) => container.name === TRACER_COPY_CONTAINER_NAME)) {
    throw new SsiConfigError(`Container name '${TRACER_COPY_CONTAINER_NAME}' is reserved for tracer injection.`)
  }
  if (template.volumes?.some((volume) => volume.name === TRACER_VOLUME_NAME)) {
    throw new SsiConfigError(`Volume name '${TRACER_VOLUME_NAME}' is reserved for tracer injection.`)
  }
}

const ensureMainContainerName = (
  template: IServiceTemplate,
  mainContainer: IContainer,
  ownsSsiState: boolean
): {template: IServiceTemplate; mainContainerName: string} => {
  if (mainContainer.name === SSI_ADOPTED_MAIN_CONTAINER_NAME) {
    if (!ownsSsiState) {
      throw new SsiConfigError(
        `Main container name '${SSI_ADOPTED_MAIN_CONTAINER_NAME}' is reserved for unnamed containers adopted by Datadog.`
      )
    }

    return {template, mainContainerName: SSI_ADOPTED_MAIN_CONTAINER_NAME}
  }
  if (mainContainer.name) {
    return {template, mainContainerName: mainContainer.name}
  }
  if (template.containers?.some((container) => container.name === SSI_ADOPTED_MAIN_CONTAINER_NAME)) {
    throw new SsiConfigError(
      `Cannot name the unnamed main container '${SSI_ADOPTED_MAIN_CONTAINER_NAME}' because another container already uses that name.`
    )
  }

  return {
    template: {
      ...template,
      containers: template.containers?.map((container) =>
        container === mainContainer ? {...container, name: SSI_ADOPTED_MAIN_CONTAINER_NAME} : container
      ),
    },
    mainContainerName: SSI_ADOPTED_MAIN_CONTAINER_NAME,
  }
}

const removeExistingSsiState = (template: IServiceTemplate, mainContainerName?: string): IServiceTemplate => {
  const restoresAdoptedMainContainerName =
    mainContainerName === undefined &&
    (template.containers ?? []).some(
      (container) =>
        container.name === SSI_ADOPTED_MAIN_CONTAINER_NAME &&
        (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
    )

  return {
    ...template,
    containers: (template.containers ?? [])
      .filter((container) => container.name !== TRACER_COPY_CONTAINER_NAME)
      .map((container) => {
        const isAdoptedMainContainer =
          container.name === SSI_ADOPTED_MAIN_CONTAINER_NAME &&
          (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
        let updated = removeExistingSsiContainer(
          container,
          mainContainerName === undefined
            ? (container.volumeMounts ?? []).some((mount) => mount.name === TRACER_VOLUME_NAME)
            : container.name === mainContainerName
        )
        if (restoresAdoptedMainContainerName) {
          updated = removeDependency(updated, SSI_ADOPTED_MAIN_CONTAINER_NAME)
        }

        return restoresAdoptedMainContainerName && isAdoptedMainContainer ? {...updated, name: ''} : updated
      }),
    volumes: (template.volumes ?? []).filter((volume) => volume.name !== TRACER_VOLUME_NAME),
  }
}

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
  const parsedHealthCheckPort = Number(
    options.healthCheckPort ?? existingSidecar?.env?.find(({name}) => name === HEALTH_PORT_ENV_VAR)?.value
  )
  const healthCheckPort = Number.isNaN(parsedHealthCheckPort) ? DEFAULT_HEALTH_CHECK_PORT : parsedHealthCheckPort

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

const removeContainerInstrumentation = (
  container: IContainer,
  agentContainerName: string,
  sharedVolumeName: string,
  envVarNames: ReadonlySet<string>,
  ownsSsiState: boolean,
  restoreAdoptedMainContainerName: boolean
): IContainer => {
  const hasTracerMount = container.volumeMounts?.some((mount) => mount.name === TRACER_VOLUME_NAME) ?? false
  let updated = ownsSsiState && hasTracerMount ? removeExistingSsiContainer(container, true) : container
  if (ownsSsiState) {
    updated = removeDependency(updated, agentContainerName)
  }
  if (restoreAdoptedMainContainerName) {
    updated = removeDependency(updated, SSI_ADOPTED_MAIN_CONTAINER_NAME)
  }

  return {
    ...updated,
    name: ownsSsiState && hasTracerMount && updated.name === SSI_ADOPTED_MAIN_CONTAINER_NAME ? '' : updated.name,
    volumeMounts: (updated.volumeMounts || []).filter((volumeMount) => volumeMount.name !== sharedVolumeName),
    env: (updated.env || []).filter(
      (envVar) => envVar.name && !envVar.name.startsWith('DD_') && !envVarNames.has(envVar.name)
    ),
  }
}
