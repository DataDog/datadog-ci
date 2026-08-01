import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'

import {createInstrumentedTemplate, parseEnvVars} from '@datadog/datadog-ci-base/helpers/serverless/common'
import {HEALTH_PORT_ENV_VAR, DEFAULT_HEALTH_CHECK_PORT} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {SERVERLESS_CLI_VERSION_TAG_NAME, SERVERLESS_CLI_VERSION_TAG_VALUE} from '@datadog/datadog-ci-base/helpers/tags'

// equivalent to google.cloud.run.v2.EmptyDirVolumeSource.Medium.MEMORY
const EMPTY_DIR_VOLUME_SOURCE_MEMORY = 1

export interface InstrumentServiceConfigOptions {
  ddService: string
  environment: string | undefined
  version: string | undefined
  envVarsByName: Record<string, IEnvVar>
  healthCheckPort: string | undefined
  sidecarName: string
  sidecarImage: string
  sidecarCpus: string
  sidecarMemory: string
  sharedVolumeName: string
  sharedVolumePath: string
}

export interface UninstrumentServiceConfigOptions {
  sidecarName: string
  sharedVolumeName: string
  envVars: string[] | undefined
}

export interface UninstrumentServiceConfigResult {
  service: IService
  warnings: string[]
}

const buildBaseSidecarContainer = (template: IServiceTemplate, options: InstrumentServiceConfigOptions): IContainer => {
  const existingSidecarContainer = template.containers?.find((container) => container.name === options.sidecarName)
  let healthCheckPort = Number(
    options.healthCheckPort ?? existingSidecarContainer?.env?.find(({name}) => name === HEALTH_PORT_ENV_VAR)?.value
  )
  healthCheckPort = Number.isNaN(healthCheckPort) ? DEFAULT_HEALTH_CHECK_PORT : healthCheckPort

  return {
    ...existingSidecarContainer,
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
  const sourceTemplate: IServiceTemplate = service.template || {}
  const template: IServiceTemplate = createInstrumentedTemplate(
    sourceTemplate,
    buildBaseSidecarContainer(sourceTemplate, options),
    {
      name: options.sharedVolumeName,
      mountPath: options.sharedVolumePath,
      mountOptions: {emptyDir: {medium: EMPTY_DIR_VOLUME_SOURCE_MEMORY}},
      volumeMountNameKey: 'name',
    },
    options.envVarsByName
  )
  template.revision = undefined

  const updatedLabels: Record<string, string> = {
    ...service.labels,
    service: options.ddService,
    [SERVERLESS_CLI_VERSION_TAG_NAME]: SERVERLESS_CLI_VERSION_TAG_VALUE.replace(/\./g, '_'),
  }
  if (options.environment) {
    updatedLabels.env = options.environment
  }
  if (options.version) {
    updatedLabels.version = options.version
  }

  return {...service, labels: updatedLabels, template}
}

const cleanUninstrumentedContainer = (
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
  const warnings: string[] = []

  if (!containers.some((container) => container.name === options.sidecarName)) {
    warnings.push(
      `Sidecar container '${options.sidecarName}' not found, so no container was removed. Specify the container name with --sidecar-name.`
    )
  }
  if (!volumes.some((volume) => volume.name === options.sharedVolumeName)) {
    warnings.push(
      `Shared volume '${options.sharedVolumeName}' not found, so no shared volume was removed. Specify the shared volume name with --shared-volume-name.`
    )
  }

  const configuredEnvVars = parseEnvVars(options.envVars)
  const updatedContainers = containers
    .filter((container) => container.name !== options.sidecarName)
    .map((container) => cleanUninstrumentedContainer(container, options.sharedVolumeName, configuredEnvVars))
  const updatedVolumes = volumes.filter((volume) => volume.name !== options.sharedVolumeName)

  const updatedLabels = {...service.labels}
  delete updatedLabels.service
  delete updatedLabels.env
  delete updatedLabels.version
  delete updatedLabels[SERVERLESS_CLI_VERSION_TAG_NAME]

  return {
    service: {
      ...service,
      labels: updatedLabels,
      template: {
        ...template,
        containers: updatedContainers,
        volumes: updatedVolumes,
        revision: undefined,
      },
    },
    warnings,
  }
}
