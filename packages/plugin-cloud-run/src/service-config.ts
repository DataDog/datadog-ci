import type {SsiConfigResult} from './ssi'
import type {IContainer, IEnvVar, IService, IServiceTemplate, IVolume} from './types'
import type {RuntimeCopyPlan} from '@datadog/datadog-ci-base/helpers/serverless/ssi/runtime-copy'

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
import {buildRuntimeCopyPlan} from '@datadog/datadog-ci-base/helpers/serverless/ssi/runtime-copy'
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

const TRACER_COPY_SCRIPT = [
  'set -e',
  'root=$1',
  'marker=$2',
  'port=$3',
  'shift 3',
  'if [ ! -x /datadog-init/copy-lib.sh ]; then echo "datadog: /datadog-init/copy-lib.sh is missing from the tracer image" >&2; exit 1; fi',
  '/datadog-init/copy-lib.sh "$root"',
  'if [ ! -f "$marker" ]; then echo "datadog: tracer copy did not complete (missing $marker)" >&2; exit 1; fi',
  'while [ "$#" -gt 0 ]; do',
  '  count=$1',
  '  shift',
  '  found=""',
  '  names=""',
  '  i=0',
  '  while [ "$i" -lt "$count" ]; do',
  '    candidate=$1',
  '    shift',
  '    names="$names $candidate"',
  '    if [ -z "$found" ] && [ -r "$candidate" ]; then found=$candidate; fi',
  '    i=$((i+1))',
  '  done',
  '  if [ -z "$found" ]; then echo "datadog: none of these tracer artifacts were copied:$names" >&2; exit 1; fi',
  'done',
  'echo "datadog: tracer install verified in $root"',
  // TODO(SVLS-9302): Node.js and Ruby lack nc/python; all tracer images need a stable readiness-server contract.
  'if command -v nc >/dev/null 2>&1; then',
  '  while true; do nc -l -p "$port" </dev/null >/dev/null 2>&1 || nc -l "$port" </dev/null >/dev/null 2>&1 || sleep 1; done',
  'elif command -v python3 >/dev/null 2>&1; then',
  '  python3 -c \'import socket,sys\nlistener=socket.socket()\nlistener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\nlistener.bind(("0.0.0.0", int(sys.argv[1])))\nlistener.listen(64)\nwhile True:\n    listener.accept()[0].close()\' "$port"',
  'else',
  '  echo "datadog: no TCP listener is available in the tracer image" >&2',
  '  exit 1',
  'fi',
].join('\n')

const buildTracerCopyArgs = (plan: RuntimeCopyPlan): string[] => {
  if (plan.ordering.kind !== 'cloud-run-idling-sidecar') {
    throw new Error(`Unsupported Cloud Run runtime-copy ordering: ${plan.ordering.kind}`)
  }

  const artifactArgs = plan.artifacts.flatMap((requirement) => [String(requirement.length), ...requirement])

  return [
    '-c',
    TRACER_COPY_SCRIPT,
    plan.containerName,
    plan.mountPath,
    plan.completionMarker,
    String(plan.ordering.readinessPort),
    ...artifactArgs,
  ]
}

const buildTracerCopyContainer = (plan: RuntimeCopyPlan): IContainer => {
  if (plan.ordering.kind !== 'cloud-run-idling-sidecar') {
    throw new Error(`Unsupported Cloud Run runtime-copy ordering: ${plan.ordering.kind}`)
  }

  return {
    name: plan.containerName,
    image: plan.image,
    command: ['/bin/sh'],
    args: buildTracerCopyArgs(plan),
    volumeMounts: [{name: plan.volumeName, mountPath: plan.mountPath}],
    resources: plan.resources?.memory ? {limits: {memory: plan.resources.memory}} : undefined,
    startupProbe: {
      tcpSocket: {port: plan.ordering.readinessPort},
      initialDelaySeconds: 0,
      periodSeconds: 5,
      failureThreshold: 48,
      timeoutSeconds: 1,
    },
  }
}

const buildTracerVolume = (volumeName: string): IVolume => ({
  name: volumeName,
  emptyDir: {medium: MEMORY_VOLUME_MEDIUM},
})

const applyRuntimeCopyPlan = (
  template: IServiceTemplate,
  plan: RuntimeCopyPlan,
  mainContainerName: string,
  dependencyNames: readonly string[]
): IServiceTemplate => {
  const containers = [...(template.containers ?? [])]
  const mainContainerIndex = containers.findIndex((container) => container.name === mainContainerName)
  if (mainContainerIndex === -1) {
    throw new SsiConfigError(`Main container '${mainContainerName}' was not found in the service template.`)
  }

  const mainContainer = containers[mainContainerIndex]
  assertNoDependencyCycle(containers, ingressName, [plan.containerName, ...dependencyNames])
  const managedDependencies = new Set([plan.containerName, ...dependencyNames])
  containers[mainContainerIndex] = {
    ...mainContainer,
    volumeMounts: [
      ...(mainContainer.volumeMounts ?? []).filter((mount) => mount.name !== plan.volumeName),
      {name: plan.volumeName, mountPath: plan.mountPath},
    ],
    dependsOn: [
      ...(mainContainer.dependsOn ?? []).filter((name) => !managedDependencies.has(name)),
      plan.containerName,
      ...dependencyNames,
    ],
  }

  containers.push(buildTracerCopyContainer(plan))

  return {
    ...template,
    containers,
    volumes: [...(template.volumes ?? []), buildTracerVolume(plan.volumeName)],
  }
}

const assertNoDependencyCycle = (
  containers: readonly IContainer[],
  ingressName: string,
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
      if (name === ingressName) {
        throw new SsiConfigError(
          `Cannot make ingress container '${ingressName}' depend on '${dependencyName}' because that container already depends on the ingress directly or transitively.`
        )
      }
      if (!visited.has(name)) {
        visited.add(name)
        pending.push(...(containersByName.get(name)?.dependsOn ?? []))
      }
    }
  }
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

  if (ssiConfig.kind === 'single-language') {
    template = {
      ...template,
      containers: template.containers?.map((container) =>
        targetContainerNames?.has(container.name ?? '')
          ? {...container, env: mergeLanguageInjectionEnv(container.env, ssiConfig.spec)}
          : container
      ),
    }
    const plan = buildRuntimeCopyPlan(
      {
        image: ssiConfig.spec.image,
        containerName: TRACER_COPY_CONTAINER_NAME,
        volumeName: TRACER_VOLUME_NAME,
        mountPath: TRACER_MOUNT_PATH,
        completionMarker: `${TRACER_MOUNT_PATH}/.copy-finished`,
        artifacts: ssiConfig.spec.artifacts as RuntimeCopyPlan['artifacts'],
      },
      {kind: 'cloud-run-idling-sidecar', readinessPort: TRACER_READINESS_PORT}
    )
    template = applyRuntimeCopyPlan(template, plan, [...targetContainerNames!][0], [options.sidecarName])
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
  const restoreAdoptedIngressName =
    ownsSsiState &&
    containers.some(
      (container) =>
        container.name === SSI_ADOPTED_INGRESS_CONTAINER_NAME &&
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
        restoreAdoptedIngressName
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

const removeExistingSsiState = (template: IServiceTemplate, mainContainerName: string): IServiceTemplate => ({
  ...template,
  containers: (template.containers ?? [])
    .filter((container) => container.name !== TRACER_COPY_CONTAINER_NAME)
    .map((container) => removeExistingSsiContainer(container, container.name === mainContainerName)),
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
  restoreAdoptedIngressName: boolean
): IContainer => {
  const hasTracerMount = container.volumeMounts?.some((mount) => mount.name === TRACER_VOLUME_NAME) ?? false
  let updated = ownsSsiState && hasTracerMount ? removeExistingSsiContainer(container, true) : container
  if (ownsSsiState) {
    updated = removeDependency(updated, agentContainerName)
  }
  if (restoreAdoptedIngressName) {
    updated = removeDependency(updated, SSI_ADOPTED_INGRESS_CONTAINER_NAME)
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
