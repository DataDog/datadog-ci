import type {SsiConfigResult} from './ssi'
import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'

import {createInstrumentedTemplate} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DD_TRACE_ENABLED_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  DEFAULT_HEALTH_CHECK_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {TRACER_COPY_CONTAINER_NAME, TRACER_VOLUME_NAME} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
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
const INSTRUMENTATION_LABELS = new Set([...Object.values(UNIFIED_SERVICE_TAG_LABELS), SERVERLESS_CLI_VERSION_TAG_NAME])

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
  const ssiConfig = options.ssiConfig ?? {kind: 'no-injection', warnings: []}
  if (ssiConfig.kind === 'errors') {
    throw new SsiConfigError(ssiConfig.errors.join('\n'))
  }

  let sourceTemplate: IServiceTemplate = service.template || {}
  let targetContainerNames: ReadonlySet<string> | undefined
  const envVarsByName = {...options.envVarsByName}
  const ownsSsiState = service.labels?.[SSI_INJECTION_MODE_LABEL] === SINGLE_LANGUAGE_SSI_MODE

  if (ssiConfig.kind === 'no-injection') {
    // If the tracer container already exists, remove it from the target container names if we're in no-injection mode
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
      ? scrubPriorSsiState(namedMainContainer.template, namedMainContainer.mainContainerName)
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

  if (ssiConfig.kind === 'single-language') {
    template = {
      ...template,
      containers: template.containers?.map((container) =>
        targetContainerNames?.has(container.name ?? '')
          ? {...container, env: mergeLanguageInjectionEnv(container.env, ssiConfig.spec)}
          : container
      ),
    }
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
  const updatedContainers = containers
    .filter((container) => container.name !== options.sidecarName)
    .map((container) => removeContainerInstrumentation(container, options.sharedVolumeName, options.envVarNames))
  const updatedVolumes = volumes.filter((volume) => volume.name !== options.sharedVolumeName)
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

const scrubPriorSsiState = (template: IServiceTemplate, mainContainerName: string): IServiceTemplate => ({
  ...template,
  containers: (template.containers ?? [])
    .filter((container) => container.name !== TRACER_COPY_CONTAINER_NAME)
    .map((container) => scrubPriorSsiContainer(container, container.name === mainContainerName)),
  volumes: (template.volumes ?? []).filter((volume) => volume.name !== TRACER_VOLUME_NAME),
})

const scrubPriorSsiContainer = (container: IContainer, isMainContainer: boolean): IContainer => {
  const existingEnv = container.env ?? []
  const env = isMainContainer ? removeLanguageInjectionEnv(existingEnv) : existingEnv
  const envChanged = env.length !== existingEnv.length || env.some((variable, index) => variable !== existingEnv[index])
  const existingMounts = container.volumeMounts ?? []
  const volumeMounts = existingMounts.filter((mount) => mount.name !== TRACER_VOLUME_NAME)

  let scrubbed = container
  if (envChanged) {
    scrubbed = {...scrubbed, env}
  }
  if (volumeMounts.length !== existingMounts.length) {
    scrubbed = {...scrubbed, volumeMounts}
  }

  return removeDependency(scrubbed, TRACER_COPY_CONTAINER_NAME)
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
  sharedVolumeName: string,
  envVarNames: ReadonlySet<string>
): IContainer => ({
  ...container,
  volumeMounts: (container.volumeMounts || []).filter((volumeMount) => volumeMount.name !== sharedVolumeName),
  env: (container.env || []).filter(
    (envVar) => envVar.name && !envVar.name.startsWith('DD_') && !envVarNames.has(envVar.name)
  ),
})
