import type {
  ContainerDefinition,
  KeyValuePair,
  LogConfiguration,
  MountPoint,
  Secret,
  Tag,
  TaskDefinition,
  Volume,
} from '@aws-sdk/client-ecs'
import type {CompositeInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {DD_TAGS_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {getCompositeInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/composite'
import {
  TRACER_CONTAINER_NAME,
  TRACER_MOUNT_PATH,
  TRACER_VOLUME_NAME,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  hasEnvFragment,
  hasInjectionModeTag,
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeEnvFragment,
  removeInjectionModeTag,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  DEFAULT_TRACER_LIBC,
  LIBCS,
  getLanguageCompatibilityErrors,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {
  DEFAULT_TRACER_VERSION,
  LANGUAGE_METADATA,
  TRACER_IMAGE_TAG_REG_EXP,
  TRACER_INJECTION_LANGUAGES,
  isTracerInjectionLanguage,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {TRACING_MODES, type TracingMode} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracing'
import {removeUndefinedValues} from '@datadog/datadog-ci-base/helpers/utils'

import {
  AGENT_CONTAINER_NAME,
  LOG_ROUTER_CONTAINER_NAME,
  MULTI_LANGUAGE_SSI_MODE,
  SINGLE_LANGUAGE_SSI_MODE,
  SSI_INJECTION_MODE_TAG,
  SUCCESS_DEPENDENCY_CONDITION,
  WINDOWS_OS_FAMILY_PREFIX,
} from './constants'

export {SSI_INJECTION_MODE_TAG, SINGLE_LANGUAGE_SSI_MODE, MULTI_LANGUAGE_SSI_MODE}

export const ECS_FARGATE_TRACER_REGISTRY = 'public.ecr.aws/datadog' as const
const ECS_FARGATE_COMPOSITE_SPEC = getCompositeInjectionSpec(ECS_FARGATE_TRACER_REGISTRY)
const COPY_LIB_ENTRYPOINT = ['/datadog-init/copy-lib.sh']
const INJECTION_LANGUAGE_ALIASES: Record<string, Language> = {dotnet: 'csharp'}

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'; tracing: Exclude<TracingMode, 'inject'>}
  | {kind: 'single-language'; language: Language; libc: Libc; spec: LanguageInjectionSpec}
  | {kind: 'multi-language'; spec: CompositeInjectionSpec}
) & {warnings: readonly string[]}

export type InjectionConfig = Extract<SsiConfigResult, {kind: 'single-language' | 'multi-language'}>

export type SsiOptions = {
  tracing?: string
  language?: string
  tracerVersion?: string
  tracerLibc?: string
}

const RESERVED_CONTAINER_NAMES = new Set([AGENT_CONTAINER_NAME, LOG_ROUTER_CONTAINER_NAME, TRACER_CONTAINER_NAME])

/** Resolves ECS Fargate tracer inputs before any remote work. */
export const resolveSsiConfig = (config: SsiOptions): SsiConfigResult => {
  const errors = validateSsiInputs(config)
  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings: []}
  }

  const tracing = config.tracing === 'disabled' ? 'disabled' : config.tracing === 'inject' ? 'inject' : 'manual'
  if (tracing !== 'inject') {
    const unusedFlags = [
      config.tracerVersion !== undefined ? '--tracer-version' : undefined,
      config.tracerLibc !== undefined ? '--tracer-libc' : undefined,
    ].filter((flag): flag is string => flag !== undefined)

    return unusedFlags.length > 0
      ? {
          kind: 'errors',
          errors: [
            `Tracer options ${unusedFlags.join(', ')} require --tracing inject. Remove these options or use --tracing inject.`,
          ],
          warnings: [],
        }
      : {kind: 'no-injection', tracing, warnings: []}
  }

  if (config.language === undefined) {
    const unsupportedFlags = [
      config.tracerVersion !== undefined ? '--tracer-version' : undefined,
      config.tracerLibc !== undefined ? '--tracer-libc' : undefined,
    ].filter((flag): flag is string => flag !== undefined)
    if (unsupportedFlags.length > 0) {
      return {
        kind: 'errors',
        errors: [
          `${unsupportedFlags.join(', ')} ${
            unsupportedFlags.length === 1 ? 'requires' : 'require'
          } --language because automatic language detection cannot apply per-language tracer settings. Add --language or remove these options.`,
        ],
        warnings: [],
      }
    }

    return {kind: 'multi-language', spec: ECS_FARGATE_COMPOSITE_SPEC, warnings: []}
  }
  if (config.language === 'go') {
    return {
      kind: 'errors',
      errors: [
        'Go automatic instrumentation is not supported. Install dd-trace-go in the application image and use --tracing manual.',
      ],
      warnings: [],
    }
  }

  const language = resolveInjectionLanguage(config.language)
  if (language === undefined) {
    return {
      kind: 'errors',
      errors: [
        `--tracing inject supports only these languages: ${TRACER_INJECTION_LANGUAGES.join(', ')}. \`dotnet\` is accepted as an alias for \`csharp\`.`,
      ],
      warnings: [],
    }
  }

  const version = config.tracerVersion ?? DEFAULT_TRACER_VERSION
  const libc = config.tracerLibc === 'musl' ? 'musl' : DEFAULT_TRACER_LIBC
  const compatibilityErrors = getLanguageCompatibilityErrors({language, libc, version}, {probeServer: false})
  if (compatibilityErrors.length > 0) {
    return {kind: 'errors', errors: compatibilityErrors, warnings: []}
  }

  return {
    kind: 'single-language',
    language,
    libc,
    spec: getLanguageInjectionSpec({
      language,
      registry: ECS_FARGATE_TRACER_REGISTRY,
      version,
      libc,
      root: TRACER_MOUNT_PATH,
    }),
    warnings:
      language === 'java'
        ? [
            'Java 24+ applications require an additional JVM flag that datadog-ci cannot set safely without knowing your runtime version.',
          ]
        : [],
  }
}

const resolveInjectionLanguage = (language: string): Language | undefined =>
  isTracerInjectionLanguage(language) ? language : INJECTION_LANGUAGE_ALIASES[language]

/** Selects one application container by stable index. Never uses list order when several candidates exist. */
export const selectApplicationContainer = (
  containers: readonly ContainerDefinition[],
  requestedName: string | undefined
): number => {
  const candidates = containers
    .map((container, index) => ({container, index}))
    .filter(({container}) => container.name === undefined || !RESERVED_CONTAINER_NAMES.has(container.name))
  const containerName = requestedName?.trim() || undefined

  if (containerName !== undefined) {
    if (RESERVED_CONTAINER_NAMES.has(containerName)) {
      throw new SsiConfigError(
        `Cannot inject a tracer into the ${containerName} container. Specify an application container with --container-name.`
      )
    }

    const matches = candidates.filter(({container}) => container.name === containerName)
    if (matches.length !== 1) {
      throw new SsiConfigError(
        matches.length === 0
          ? `Application container '${containerName}' was not found. Choose one of: ${formatContainerNames(candidates)}.`
          : `Application container name '${containerName}' is not unique. Give each application container a unique name before retrying.`
      )
    }

    return matches[0].index
  }

  if (candidates.length === 1) {
    return candidates[0].index
  }
  if (candidates.length === 0) {
    throw new SsiConfigError(
      'Cannot enable automatic instrumentation because no application container was found. Add an application container, then retry.'
    )
  }

  throw new SsiConfigError(
    `Cannot select an application container because the task definition has multiple candidates: ${formatContainerNames(
      candidates
    )}. Specify one with --container-name.`
  )
}

export const getInjectionMountPath = (config: InjectionConfig): string =>
  config.kind === 'single-language' ? TRACER_MOUNT_PATH : config.spec.mountPath

export const assertInjectionEnvCanBeMerged = (
  container: ContainerDefinition | undefined,
  config: InjectionConfig,
  windows: boolean
): void =>
  assertEnvironmentFragmentsCanBeMerged(
    container,
    config.spec.env,
    config.kind === 'single-language' ? [DD_TAGS_ENV_VAR] : [],
    windows
  )

export const assertSsiResourcesCanBeAdded = (
  containers: readonly ContainerDefinition[],
  volumes: readonly Volume[] | undefined,
  targetIndex: number,
  mountPath: string
): void => {
  if (containers.some(({name}) => name === TRACER_CONTAINER_NAME)) {
    throw new SsiConfigError(
      `A container named '${TRACER_CONTAINER_NAME}' already exists. Rename or remove it before retrying.`
    )
  }
  if (volumes?.some(({name}) => name === TRACER_VOLUME_NAME)) {
    throw new SsiConfigError(
      `A volume named '${TRACER_VOLUME_NAME}' already exists. Rename or remove it before retrying.`
    )
  }

  const target = containers[targetIndex]
  const hasConflictingMount = containers.some(
    (container, index) =>
      !RESERVED_CONTAINER_NAMES.has(container.name ?? '') &&
      (container.mountPoints ?? []).some(
        ({sourceVolume, containerPath}) =>
          sourceVolume === TRACER_VOLUME_NAME || (index === targetIndex && containerPath === mountPath)
      )
  )
  if (hasConflictingMount) {
    throw new SsiConfigError(
      `An application container volume mount conflicts with the managed '${TRACER_VOLUME_NAME}' volume at '${mountPath}' on '${
        target?.name ?? '<unnamed>'
      }'. Rename or remove the conflicting mount before retrying.`
    )
  }
}

export const mergeLanguageInjectionEnv = (
  container: ContainerDefinition,
  spec: LanguageInjectionSpec,
  windows: boolean
): KeyValuePair[] => {
  const merged = mergeInjectionEnv(container, spec.env, [DD_TAGS_ENV_VAR], windows)
  const existingTags = findEnv(merged, DD_TAGS_ENV_VAR, windows)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value), windows)
}

export const mergeCompositeInjectionEnv = (
  container: ContainerDefinition,
  spec: CompositeInjectionSpec,
  windows: boolean
): KeyValuePair[] => mergeInjectionEnv(container, spec.env, [], windows)

/** Removes exact tracer fragments for every supported injection mode. */
export const removeInjectionEnv = (container: ContainerDefinition, windows: boolean): KeyValuePair[] | undefined => {
  const updated = (container.environment ?? []).flatMap((variable) => {
    if (!variable.name || !variable.value) {
      return [variable]
    }

    const fragments = INJECTION_ENV_FRAGMENTS.filter(({name}) => isNamed(variable.name, name, windows))
    const withoutTag = isNamed(variable.name, DD_TAGS_ENV_VAR, windows)
      ? removeInjectionModeTag(variable.value)
      : variable.value
    const value = fragments.reduce<string | undefined>(removeEnvFragment, withoutTag)

    return value === undefined ? [] : [value === variable.value ? variable : {...variable, value}]
  })

  return container.environment === undefined && updated.length === 0 ? undefined : updated
}

export const hasSsiMarker = (
  taskDefinition: Pick<TaskDefinition, 'containerDefinitions' | 'runtimePlatform'>,
  tags: Tag[]
): boolean => {
  const windows = isWindowsTask(taskDefinition)

  return (
    tags.some((tag) => tag.key === SSI_INJECTION_MODE_TAG) ||
    (taskDefinition.containerDefinitions ?? []).some((container) =>
      (container.environment ?? []).some(
        ({name, value}) => isNamed(name, DD_TAGS_ENV_VAR, windows) && hasInjectionModeTag(value)
      )
    )
  )
}

export const hasSsi = (taskDefinition: TaskDefinition, tags: Tag[] = []): boolean =>
  hasSsiMarker(taskDefinition, tags) ||
  (taskDefinition.containerDefinitions ?? []).some((_, index) => hasCompleteSsiSignature(taskDefinition, index))

export const hasCompleteSsiSignature = (taskDefinition: TaskDefinition, targetIndex: number): boolean => {
  const containers = taskDefinition.containerDefinitions ?? []
  const target = containers[targetIndex]
  if (!target) {
    return false
  }

  const tracerContainers = containers.flatMap((container) => {
    const config = getManagedTracerConfig(container)

    return config === undefined ? [] : [{container, config}]
  })
  const volumes = (taskDefinition.volumes ?? []).filter(({name}) => name === TRACER_VOLUME_NAME)
  const tracerMounts = containers.flatMap((container, index) =>
    (container.mountPoints ?? [])
      .filter(({sourceVolume}) => sourceVolume === TRACER_VOLUME_NAME)
      .map((mount) => ({index, mount}))
  )
  const managedTracer = tracerContainers[0]
  const windows = isWindowsTask(taskDefinition)

  return (
    tracerContainers.length === 1 &&
    volumes.length === 1 &&
    tracerMounts.length === 1 &&
    tracerMounts[0].index === targetIndex &&
    tracerMounts[0].mount.containerPath === managedTracer.config.mountPath &&
    target.dependsOn?.some(
      (dependency) =>
        dependency.containerName === TRACER_CONTAINER_NAME && dependency.condition === SUCCESS_DEPENDENCY_CONDITION
    ) === true &&
    hasManagedTracerEnvironment(target, managedTracer.config, windows)
  )
}

export const removeSsiState = (taskDefinition: TaskDefinition): TaskDefinition => {
  const windows = isWindowsTask(taskDefinition)
  const containers = (taskDefinition.containerDefinitions ?? [])
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
    containerDefinitions: containers,
    volumes: taskDefinition.volumes?.filter(({name}) => name !== TRACER_VOLUME_NAME),
  })
}

export const applySsi = (
  containers: ContainerDefinition[],
  volumes: Volume[] | undefined,
  targetIndex: number,
  config: InjectionConfig,
  logConfiguration: LogConfiguration | undefined,
  windows: boolean
): {containerDefinitions: ContainerDefinition[]; volumes: Volume[]} => {
  const mountPath = getInjectionMountPath(config)
  const tracerMount: MountPoint = {sourceVolume: TRACER_VOLUME_NAME, containerPath: mountPath, readOnly: false}
  const containerDefinitions = containers.map((container, index) => {
    if (index !== targetIndex) {
      return container
    }

    const dependsOn = [
      ...(container.dependsOn ?? []).filter(({containerName}) => containerName !== TRACER_CONTAINER_NAME),
      {containerName: TRACER_CONTAINER_NAME, condition: SUCCESS_DEPENDENCY_CONDITION},
    ]

    return removeUndefinedValues({
      ...container,
      environment:
        config.kind === 'single-language'
          ? mergeLanguageInjectionEnv(container, config.spec, windows)
          : mergeCompositeInjectionEnv(container, config.spec, windows),
      mountPoints: [...(container.mountPoints ?? []), tracerMount],
      dependsOn,
    })
  })

  containerDefinitions.push(buildTracerContainer(config.spec.image, mountPath, logConfiguration))

  return {
    containerDefinitions,
    volumes: [...(volumes ?? []), {name: TRACER_VOLUME_NAME}],
  }
}

export const ssiInjectionModeTagValue = (config: SsiConfigResult): string | undefined => {
  if (config.kind === 'single-language') {
    return SINGLE_LANGUAGE_SSI_MODE
  }
  if (config.kind === 'multi-language') {
    return MULTI_LANGUAGE_SSI_MODE
  }

  return undefined
}

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}

const validateSsiInputs = (config: SsiOptions): string[] => {
  const errors: string[] = []
  if (config.tracing !== undefined && !(TRACING_MODES as readonly string[]).includes(config.tracing)) {
    errors.push(`Invalid tracing mode ${JSON.stringify(config.tracing)}. Possible values: ${TRACING_MODES.join(', ')}.`)
  }
  if (config.language !== undefined && (typeof config.language !== 'string' || config.language.length === 0)) {
    errors.push(`Invalid language ${JSON.stringify(config.language)}.`)
  }
  if (
    config.tracerVersion !== undefined &&
    (typeof config.tracerVersion !== 'string' || !TRACER_IMAGE_TAG_REG_EXP.test(config.tracerVersion))
  ) {
    errors.push(`Invalid tracer version ${JSON.stringify(config.tracerVersion)}.`)
  }
  if (config.tracerLibc !== undefined && !(LIBCS as readonly string[]).includes(config.tracerLibc)) {
    errors.push(`Invalid tracer libc ${JSON.stringify(config.tracerLibc)}. Possible values: ${LIBCS.join(', ')}.`)
  }

  return errors
}

const formatContainerNames = (candidates: readonly {container: ContainerDefinition}[]): string =>
  candidates.map(({container}) => container.name || '<unnamed>').join(', ')

const isWindowsTask = (taskDefinition: Pick<TaskDefinition, 'runtimePlatform'>): boolean =>
  taskDefinition.runtimePlatform?.operatingSystemFamily?.toUpperCase().startsWith(WINDOWS_OS_FAMILY_PREFIX) ?? false

const isNamed = (declared: string | undefined, name: string, windows: boolean): boolean =>
  windows ? declared?.toLowerCase() === name.toLowerCase() : declared === name

const findEnv = (env: readonly KeyValuePair[], name: string, windows: boolean): KeyValuePair | undefined =>
  env.find((variable) => isNamed(variable.name, name, windows))

const findSecret = (secrets: readonly Secret[] | undefined, name: string, windows: boolean): Secret | undefined =>
  secrets?.find((secret) => isNamed(secret.name, name, windows))

const assertEnvironmentFragmentsCanBeMerged = (
  container: ContainerDefinition | undefined,
  fragments: readonly EnvFragment[],
  extraNames: readonly string[],
  windows: boolean
): void => {
  const env = container?.environment ?? []
  const targetNames = new Set([...fragments.map(({name}) => name), ...extraNames])
  for (const name of targetNames) {
    const matching = env.filter((variable) => isNamed(variable.name, name, windows))
    if (matching.length > 1) {
      throw new SsiConfigError(
        `${name} appears more than once on the selected application container. Remove the duplicate before retrying.`
      )
    }
    if (findSecret(container?.secrets, name, windows)) {
      throw new SsiConfigError(
        `${name} on the selected application container comes from a secret. Set it to a literal value or remove it before retrying.`
      )
    }
  }
}

const upsertEnv = (env: readonly KeyValuePair[], name: string, value: string, windows: boolean): KeyValuePair[] => {
  const index = env.findIndex((variable) => isNamed(variable.name, name, windows))

  return index === -1
    ? [...env, {name, value}]
    : env.map((variable, variableIndex) => (variableIndex === index ? {...variable, value} : variable))
}

const mergeInjectionEnv = (
  container: ContainerDefinition,
  fragments: readonly EnvFragment[],
  extraNames: readonly string[],
  windows: boolean
): KeyValuePair[] => {
  assertEnvironmentFragmentsCanBeMerged(container, fragments, extraNames, windows)

  return fragments.reduce<KeyValuePair[]>(
    (env, fragment) => {
      const existing = findEnv(env, fragment.name, windows)

      return upsertEnv(env, fragment.name, mergeInjectionEnvFragment(existing?.value, fragment), windows)
    },
    [...(container.environment ?? [])]
  )
}

const mergeInjectionEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string => {
  try {
    return mergeEnvFragment(currentValue, fragment)
  } catch (error) {
    throw new SsiConfigError(
      `Cannot enable automatic instrumentation while updating ${fragment.name}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

const LANGUAGE_ENV_VARIANTS = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
  LIBCS.map((libc) => ({
    language,
    env: getLanguageInjectionSpec({
      language,
      libc,
      registry: ECS_FARGATE_TRACER_REGISTRY,
      version: DEFAULT_TRACER_VERSION,
      root: TRACER_MOUNT_PATH,
    }).env,
  }))
)
const LANGUAGE_ENV_FRAGMENTS: readonly EnvFragment[] = LANGUAGE_ENV_VARIANTS.flatMap(({env}) => env)
const INJECTION_ENV_FRAGMENTS: readonly EnvFragment[] = [...LANGUAGE_ENV_FRAGMENTS, ...ECS_FARGATE_COMPOSITE_SPEC.env]
const MANAGED_TRACER_MOUNT_PATHS = new Set([TRACER_MOUNT_PATH, ECS_FARGATE_COMPOSITE_SPEC.mountPath])

interface ManagedTracerConfig {
  readonly mountPath: string
  readonly envVariants: readonly (readonly EnvFragment[])[]
}

const hasManagedTracerEnvironment = (
  container: ContainerDefinition,
  config: ManagedTracerConfig,
  windows: boolean
): boolean => {
  const env = container.environment ?? []

  return config.envVariants.some((fragments) =>
    fragments.every((fragment) => hasEnvFragment(findEnv(env, fragment.name, windows)?.value, fragment))
  )
}

const getTracerContainerLanguage = (container: ContainerDefinition): Language | undefined =>
  TRACER_INJECTION_LANGUAGES.find((language) => {
    const prefix = `${ECS_FARGATE_TRACER_REGISTRY}/dd-lib-${LANGUAGE_METADATA[language].tracerLanguage}-init:`
    const version = container.image?.startsWith(prefix) ? container.image.slice(prefix.length) : undefined

    return version !== undefined && TRACER_IMAGE_TAG_REG_EXP.test(version)
  })

const getManagedTracerConfig = (container: ContainerDefinition): ManagedTracerConfig | undefined => {
  const language = getTracerContainerLanguage(container)
  const config =
    language === undefined
      ? container.image === ECS_FARGATE_COMPOSITE_SPEC.image
        ? {
            mountPath: ECS_FARGATE_COMPOSITE_SPEC.mountPath,
            envVariants: [ECS_FARGATE_COMPOSITE_SPEC.env],
          }
        : undefined
      : {
          mountPath: TRACER_MOUNT_PATH,
          envVariants: LANGUAGE_ENV_VARIANTS.filter((variant) => variant.language === language).map(({env}) => env),
        }

  return config !== undefined && hasManagedTracerContainerShape(container, config.mountPath) ? config : undefined
}

const hasManagedTracerContainerShape = (container: ContainerDefinition, mountPath: string): boolean =>
  container.name === TRACER_CONTAINER_NAME &&
  container.essential === false &&
  container.entryPoint?.length === 1 &&
  container.entryPoint[0] === COPY_LIB_ENTRYPOINT[0] &&
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
    entryPoint: [...COPY_LIB_ENTRYPOINT],
    command: [mountPath],
    mountPoints: [{sourceVolume: TRACER_VOLUME_NAME, containerPath: mountPath, readOnly: false}],
    logConfiguration,
  })
