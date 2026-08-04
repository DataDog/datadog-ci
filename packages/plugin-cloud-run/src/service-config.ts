import type {SsiFlagValidation} from './ssi'
import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'

import {createInstrumentedTemplate} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {
  DD_TRACE_ENABLED_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  DEFAULT_HEALTH_CHECK_PORT,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  SSI_ADOPTION_LABEL_NAME,
  SSI_ADOPTION_LABEL_VALUE,
  SSI_APP_CONTAINER_NAME,
  TRACER_COPY_CONTAINER_NAME,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

import {mergeNativeInjectionEnv, removeKnownNativeInjectionEnv, selectIngressContainer, SsiValidationError} from './ssi'

const MEMORY_VOLUME_MEDIUM = 1 as const // google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const UNIFIED_SERVICE_TAG_LABELS = {
  service: 'service',
  environment: 'env',
  version: 'version',
} as const
const INSTRUMENTATION_LABELS = new Set([...Object.values(UNIFIED_SERVICE_TAG_LABELS), SERVERLESS_CLI_VERSION_TAG_NAME])

export interface InstrumentServiceConfigOptions {
  /** Defaults to disabled for legacy callers. */
  readonly ssi?: SsiFlagValidation
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

const removeDependencies = (container: IContainer, names: ReadonlySet<string>): IContainer => {
  if (!container.dependsOn?.some((name) => names.has(name))) {
    return container
  }
  const dependsOn = container.dependsOn.filter((name) => !names.has(name))
  if (dependsOn.length === 0) {
    const {dependsOn: _removed, ...updated} = container

    return updated
  }

  return {...container, dependsOn}
}

const hasPriorSsiState = (service: IService, template: IServiceTemplate): boolean =>
  service.labels?.[SSI_ADOPTION_LABEL_NAME] === SSI_ADOPTION_LABEL_VALUE ||
  (template.containers ?? []).some((container) => container.name === TRACER_COPY_CONTAINER_NAME) ||
  (template.volumes ?? []).some((volume) => volume.name === TRACER_VOLUME_NAME)

const scrubPriorSsiContainer = (container: IContainer, agentContainerName: string): IContainer => {
  const existingEnv = container.env ?? []
  const env = removeKnownNativeInjectionEnv(existingEnv)
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

  return removeDependencies(scrubbed, new Set([TRACER_COPY_CONTAINER_NAME, agentContainerName]))
}

const scrubPriorSsiState = (template: IServiceTemplate, agentContainerName: string): IServiceTemplate => ({
  ...template,
  containers: (template.containers ?? [])
    .filter((container) => container.name !== TRACER_COPY_CONTAINER_NAME)
    .map((container) => scrubPriorSsiContainer(container, agentContainerName)),
  volumes: (template.volumes ?? []).filter((volume) => volume.name !== TRACER_VOLUME_NAME),
})

const replaceContainer = (
  template: IServiceTemplate,
  container: IContainer,
  replacement: IContainer
): IServiceTemplate => {
  const containers = [...(template.containers ?? [])]
  const index = containers.indexOf(container)
  if (index === -1) {
    throw new SsiValidationError('The selected ingress container was not found in the service template.')
  }
  containers[index] = replacement

  return {...template, containers}
}

const prepareIngressName = (
  template: IServiceTemplate,
  ingress: IContainer,
  singleLanguage: boolean,
  adopted: boolean
): {template: IServiceTemplate; ingressName: string} => {
  if (singleLanguage) {
    if (ingress.name === SSI_APP_CONTAINER_NAME && !adopted) {
      throw new SsiValidationError(
        `Ingress container name '${SSI_APP_CONTAINER_NAME}' is reserved for unnamed containers adopted by Datadog.`
      )
    }
    if (ingress.name) {
      return {template, ingressName: ingress.name}
    }
    if ((template.containers ?? []).some((container) => container.name === SSI_APP_CONTAINER_NAME)) {
      throw new SsiValidationError(
        `Cannot assign the unnamed ingress container the stable name '${SSI_APP_CONTAINER_NAME}' because another container already uses it.`
      )
    }

    return {
      template: replaceContainer(template, ingress, {...ingress, name: SSI_APP_CONTAINER_NAME}),
      ingressName: SSI_APP_CONTAINER_NAME,
    }
  }

  if (adopted && ingress.name === SSI_APP_CONTAINER_NAME) {
    return {template: replaceContainer(template, ingress, {...ingress, name: ''}), ingressName: ''}
  }

  return {template, ingressName: ingress.name ?? ''}
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

export const instrumentServiceConfig = (service: IService, options: InstrumentServiceConfigOptions): IService => {
  const ssi = options.ssi ?? {kind: 'disabled', warnings: []}
  if (ssi.kind === 'errors') {
    throw new SsiValidationError(ssi.errors.join('\n'))
  }

  let sourceTemplate: IServiceTemplate = service.template || {}
  let appContainerNames: ReadonlySet<string> | undefined
  const envVarsByName = {...options.envVarsByName}
  const adopted = service.labels?.[SSI_ADOPTION_LABEL_NAME] === SSI_ADOPTION_LABEL_VALUE

  if (ssi.kind === 'disabled') {
    if (sourceTemplate.containers?.some((container) => container.name === TRACER_COPY_CONTAINER_NAME)) {
      appContainerNames = new Set(
        sourceTemplate.containers
          .filter(
            (container) => container.name !== options.sidecarName && container.name !== TRACER_COPY_CONTAINER_NAME
          )
          .map((container) => container.name ?? '')
      )
    }
  } else {
    if (options.sidecarName === TRACER_COPY_CONTAINER_NAME) {
      throw new SsiValidationError(
        `The Agent sidecar name '${options.sidecarName}' is reserved for the tracer copy container.`
      )
    }
    if (options.sharedVolumeName === TRACER_VOLUME_NAME) {
      throw new SsiValidationError(`The shared volume name '${options.sharedVolumeName}' is reserved for the tracer.`)
    }

    const ingress = selectIngressContainer(
      sourceTemplate.containers ?? [],
      new Set([options.sidecarName, TRACER_COPY_CONTAINER_NAME])
    )
    const prepared = prepareIngressName(sourceTemplate, ingress, ssi.kind === 'single-language', adopted)
    sourceTemplate = prepared.template
    appContainerNames = new Set([prepared.ingressName])

    if (hasPriorSsiState(service, sourceTemplate)) {
      sourceTemplate = scrubPriorSsiState(sourceTemplate, options.sidecarName)
    }
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
    appContainerNames
  ) as IServiceTemplate

  const updatedLabels: Record<string, string> = {
    ...service.labels,
    [UNIFIED_SERVICE_TAG_LABELS.service]: options.ddService,
    [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE.replace(/\./g, '_'),
  }
  if (options.environment) {
    updatedLabels[UNIFIED_SERVICE_TAG_LABELS.environment] = options.environment
  }
  if (options.version) {
    updatedLabels[UNIFIED_SERVICE_TAG_LABELS.version] = options.version
  }

  if (ssi.kind === 'single-language') {
    const containers = [...(template.containers ?? [])]
    const ingressIndex = containers.findIndex((container) => appContainerNames?.has(container.name ?? ''))
    if (ingressIndex === -1) {
      throw new SsiValidationError('The selected ingress container was not found after Agent instrumentation.')
    }
    containers[ingressIndex] = {
      ...containers[ingressIndex],
      env: mergeNativeInjectionEnv(containers[ingressIndex].env, ssi.spec),
    }
    template = {...template, containers}
    updatedLabels[SSI_ADOPTION_LABEL_NAME] = SSI_ADOPTION_LABEL_VALUE
  } else if (ssi.kind === 'go-agent-only') {
    delete updatedLabels[SSI_ADOPTION_LABEL_NAME]
  }

  return {...service, labels: updatedLabels, template: {...template, revision: undefined}}
}

const removeContainerInstrumentation = (
  container: IContainer,
  sharedVolumeName: string,
  configuredEnvVars: Record<string, string>
): IContainer => ({
  ...container,
  volumeMounts: (container.volumeMounts || []).filter((volumeMount) => volumeMount.name !== sharedVolumeName),
  env: (container.env || []).filter(
    (envVar) => envVar.name && !envVar.name.startsWith('DD_') && !(envVar.name in configuredEnvVars)
  ),
})

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
