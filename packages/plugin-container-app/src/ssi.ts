import type {Container, ContainerApp, EnvironmentVar, InitContainer} from '@azure/arm-appcontainers'
import type {ContainerAppConfigOptions} from '@datadog/datadog-ci-base/commands/container-app/common'
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

export const SSI_INJECTION_MODE_TAG = 'dd_sls_injection_mode'
export const SINGLE_LANGUAGE_SSI_MODE = 'single_language'
export const MULTI_LANGUAGE_SSI_MODE = 'multi_language'
export const CONTAINER_APP_TRACER_REGISTRY = 'datadoghq.azurecr.io' as const
const CONTAINER_APP_COMPOSITE_SPEC = getCompositeInjectionSpec(CONTAINER_APP_TRACER_REGISTRY)

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'; tracing: Exclude<TracingMode, 'inject'>}
  | {kind: 'single-language'; language: Language; libc: Libc; spec: LanguageInjectionSpec}
  | {kind: 'multi-language'; spec: CompositeInjectionSpec}
) & {warnings: readonly string[]}

type InjectionConfig = Extract<SsiConfigResult, {kind: 'single-language' | 'multi-language'}>

/** Resolves Container Apps tracer inputs before any remote work. */
export const resolveSsiConfig = (config: ContainerAppConfigOptions): SsiConfigResult => {
  const errors = validateSsiInputs(config)
  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings: []}
  }

  const tracing = config.tracing ?? 'manual'
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

  const collisionErrors = getResourceCollisionErrors(
    config,
    config.language === undefined ? CONTAINER_APP_COMPOSITE_SPEC.mountPath : TRACER_MOUNT_PATH
  )
  if (collisionErrors.length > 0) {
    return {kind: 'errors', errors: collisionErrors, warnings: []}
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

    return {kind: 'multi-language', spec: CONTAINER_APP_COMPOSITE_SPEC, warnings: []}
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
  if (!isTracerInjectionLanguage(config.language)) {
    return {
      kind: 'errors',
      errors: [`--tracing inject supports only these languages: ${TRACER_INJECTION_LANGUAGES.join(', ')}.`],
      warnings: [],
    }
  }

  const version = config.tracerVersion ?? DEFAULT_TRACER_VERSION
  const libc = config.tracerLibc ?? DEFAULT_TRACER_LIBC
  const compatibilityErrors = getLanguageCompatibilityErrors({language: config.language, libc, version})
  if (compatibilityErrors.length > 0) {
    return {kind: 'errors', errors: compatibilityErrors, warnings: []}
  }

  return {
    kind: 'single-language',
    language: config.language,
    libc,
    spec: getLanguageInjectionSpec({
      language: config.language,
      registry: CONTAINER_APP_TRACER_REGISTRY,
      version,
      libc,
      root: TRACER_MOUNT_PATH,
    }),
    warnings:
      config.language === 'java'
        ? [
            'Java 24+ applications require an additional JVM flag that datadog-ci cannot set safely without knowing your runtime version.',
          ]
        : [],
  }
}

/** Selects one application container by stable index. */
export const selectApplicationContainer = (
  containers: readonly Container[],
  sidecarName: string,
  requestedName: string | undefined
): number => {
  const candidates = containers
    .map((container, index) => ({container, index}))
    .filter(({container}) => container.name !== sidecarName)
  const containerName = requestedName?.trim() || undefined

  if (containerName !== undefined) {
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
      'Cannot enable automatic instrumentation because no application container was found. Add an application container, or choose a different --sidecar-name if it matches your application container.'
    )
  }

  throw new SsiConfigError(
    `Cannot select an application container because the Container App has multiple candidates: ${formatContainerNames(
      candidates
    )}. Specify one with --container-name.`
  )
}

export const assertInjectionEnvCanBeMerged = (
  env: readonly EnvironmentVar[] | undefined,
  config: InjectionConfig
): void =>
  assertEnvironmentFragmentsCanBeMerged(
    env,
    config.spec.env,
    config.kind === 'single-language' ? [DD_TAGS_ENV_VAR] : []
  )

export const assertSsiResourcesCanBeAdded = (
  containerApp: ContainerApp,
  targetIndex: number,
  sidecarName: string,
  config: InjectionConfig
): void => {
  if (containerApp.template?.initContainers?.some(({name}) => name === TRACER_CONTAINER_NAME)) {
    throw new SsiConfigError(
      `An init container named '${TRACER_CONTAINER_NAME}' already exists. Rename or remove it before retrying.`
    )
  }
  if (containerApp.template?.volumes?.some(({name}) => name === TRACER_VOLUME_NAME)) {
    throw new SsiConfigError(
      `A volume named '${TRACER_VOLUME_NAME}' already exists. Rename or remove it before retrying.`
    )
  }

  const mountPath = getInjectionMountPath(config)
  const hasConflictingMount = (containerApp.template?.containers ?? []).some(
    (container, index) =>
      container.name !== sidecarName &&
      (container.volumeMounts ?? []).some(
        ({volumeName, mountPath: existingPath}) =>
          volumeName === TRACER_VOLUME_NAME || (index === targetIndex && existingPath === mountPath)
      )
  )
  if (hasConflictingMount) {
    throw new SsiConfigError(
      `An application container volume mount conflicts with the managed '${TRACER_VOLUME_NAME}' volume at '${mountPath}'. Rename or remove the conflicting mount before retrying.`
    )
  }
}

export const mergeLanguageInjectionEnv = (
  existingEnv: readonly EnvironmentVar[] | undefined,
  spec: LanguageInjectionSpec
): EnvironmentVar[] => {
  const merged = mergeInjectionEnv(existingEnv, spec.env, [DD_TAGS_ENV_VAR])
  const existingTags = merged.find(({name}) => name === DD_TAGS_ENV_VAR)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value))
}

export const mergeCompositeInjectionEnv = (
  existingEnv: readonly EnvironmentVar[] | undefined,
  spec: CompositeInjectionSpec
): EnvironmentVar[] => mergeInjectionEnv(existingEnv, spec.env)

/** Removes exact tracer fragments for every supported injection mode. */
export const removeInjectionEnv = (existingEnv: readonly EnvironmentVar[] | undefined): EnvironmentVar[] =>
  (existingEnv ?? []).flatMap((variable) => {
    if (!variable.name || variable.secretRef || !variable.value) {
      return [variable]
    }

    const fragments = INJECTION_ENV_FRAGMENTS.filter(({name}) => name === variable.name)
    const withoutTag = variable.name === DD_TAGS_ENV_VAR ? removeInjectionModeTag(variable.value) : variable.value
    const value = fragments.reduce<string | undefined>(removeEnvFragment, withoutTag)

    return value === undefined ? [] : [value === variable.value ? variable : {...variable, value}]
  })

export const hasSsiMarker = (containerApp: ContainerApp): boolean =>
  (containerApp.tags !== undefined &&
    Object.prototype.hasOwnProperty.call(containerApp.tags, SSI_INJECTION_MODE_TAG)) ||
  (containerApp.template?.containers ?? []).some((container) =>
    container.env?.some(
      ({name, secretRef, value}) => name === DD_TAGS_ENV_VAR && !secretRef && hasInjectionModeTag(value)
    )
  )

export const hasSsi = (containerApp: ContainerApp): boolean =>
  hasSsiMarker(containerApp) ||
  (containerApp.template?.containers ?? []).some((_, index) => hasCompleteSsiSignature(containerApp, index))

export const hasCompleteSsiSignature = (containerApp: ContainerApp, targetIndex: number): boolean => {
  const template = containerApp.template
  const target = template?.containers?.[targetIndex]
  if (!target) {
    return false
  }

  const initContainers =
    template?.initContainers?.flatMap((container) => {
      const config = getManagedInitConfig(container)

      return config === undefined ? [] : [{container, config}]
    }) ?? []
  const volumes =
    template?.volumes?.filter(({name, storageType}) => name === TRACER_VOLUME_NAME && storageType === 'EmptyDir') ?? []
  const tracerMounts = (template?.containers ?? []).flatMap((container, index) =>
    (container.volumeMounts ?? [])
      .filter(({volumeName}) => volumeName === TRACER_VOLUME_NAME)
      .map((mount) => ({index, mount}))
  )
  const managedInit = initContainers[0]

  return (
    initContainers.length === 1 &&
    volumes.length === 1 &&
    tracerMounts.length === 1 &&
    tracerMounts[0].index === targetIndex &&
    tracerMounts[0].mount.mountPath === managedInit.config.mountPath &&
    hasManagedTracerEnvironment(target.env, managedInit.config)
  )
}

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

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
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

const getInjectionMountPath = (config: InjectionConfig): string =>
  config.kind === 'single-language' ? TRACER_MOUNT_PATH : config.spec.mountPath

const validateSsiInputs = (config: ContainerAppConfigOptions): string[] => {
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
  if (config.containerName !== undefined && typeof config.containerName !== 'string') {
    errors.push(`Invalid application container name ${JSON.stringify(config.containerName)}.`)
  }

  return errors
}

const formatContainerNames = (candidates: readonly {container: Container}[]): string =>
  candidates.map(({container}) => container.name || '<unnamed>').join(', ')

const assertEnvironmentFragmentsCanBeMerged = (
  env: readonly EnvironmentVar[] | undefined,
  fragments: readonly EnvFragment[],
  extraNames: readonly string[] = []
): void => {
  const targetNames = new Set([...fragments.map(({name}) => name), ...extraNames])
  for (const name of targetNames) {
    const matching = (env ?? []).filter((variable) => variable.name === name)
    if (matching.length > 1) {
      throw new SsiConfigError(
        `${name} appears more than once on the selected application container. Remove the duplicate before retrying.`
      )
    }
    if (matching[0]?.secretRef) {
      throw new SsiConfigError(
        `${name} on the selected application container comes from a secret reference. Set it to a literal value or remove it before retrying.`
      )
    }
  }
}

const upsertEnv = <T extends EnvironmentVar>(env: readonly T[], name: string, value: string): T[] => {
  const index = env.findIndex((variable) => variable.name === name)

  return index === -1
    ? [...env, {name, value} as T]
    : env.map((variable, variableIndex) => (variableIndex === index ? {...variable, value} : variable))
}

const mergeInjectionEnv = (
  existingEnv: readonly EnvironmentVar[] | undefined,
  fragments: readonly EnvFragment[],
  extraNames: readonly string[] = []
): EnvironmentVar[] => {
  assertEnvironmentFragmentsCanBeMerged(existingEnv, fragments, extraNames)

  return fragments.reduce<EnvironmentVar[]>(
    (env, fragment) => {
      const existing = env.find(({name}) => name === fragment.name)

      return upsertEnv(env, fragment.name, mergeInjectionEnvFragment(existing?.value, fragment))
    },
    [...(existingEnv ?? [])]
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
      registry: CONTAINER_APP_TRACER_REGISTRY,
      version: DEFAULT_TRACER_VERSION,
      root: TRACER_MOUNT_PATH,
    }).env,
  }))
)
const LANGUAGE_ENV_FRAGMENTS: readonly EnvFragment[] = LANGUAGE_ENV_VARIANTS.flatMap(({env}) => env)
const INJECTION_ENV_FRAGMENTS: readonly EnvFragment[] = [...LANGUAGE_ENV_FRAGMENTS, ...CONTAINER_APP_COMPOSITE_SPEC.env]
const MANAGED_TRACER_MOUNT_PATHS = new Set([TRACER_MOUNT_PATH, CONTAINER_APP_COMPOSITE_SPEC.mountPath])

interface ManagedInitConfig {
  readonly mountPath: string
  readonly envVariants: readonly (readonly EnvFragment[])[]
}

const hasManagedTracerEnvironment = (
  env: readonly EnvironmentVar[] | undefined,
  config: ManagedInitConfig
): boolean => {
  const literalEnv = env ?? []

  return config.envVariants.some((fragments) =>
    fragments.every((fragment) =>
      hasEnvFragment(literalEnv.find(({name, secretRef}) => name === fragment.name && !secretRef)?.value, fragment)
    )
  )
}

const getInitContainerLanguage = (container: InitContainer): Language | undefined =>
  TRACER_INJECTION_LANGUAGES.find((language) => {
    const prefix = `${CONTAINER_APP_TRACER_REGISTRY}/dd-lib-${LANGUAGE_METADATA[language].tracerLanguage}-init:`
    const version = container.image?.startsWith(prefix) ? container.image.slice(prefix.length) : undefined

    return version !== undefined && TRACER_IMAGE_TAG_REG_EXP.test(version)
  })

const getManagedInitConfig = (container: InitContainer): ManagedInitConfig | undefined => {
  const language = getInitContainerLanguage(container)
  const config =
    language === undefined
      ? container.image === CONTAINER_APP_COMPOSITE_SPEC.image
        ? {
            mountPath: CONTAINER_APP_COMPOSITE_SPEC.mountPath,
            envVariants: [CONTAINER_APP_COMPOSITE_SPEC.env],
          }
        : undefined
      : {
          mountPath: TRACER_MOUNT_PATH,
          envVariants: LANGUAGE_ENV_VARIANTS.filter((variant) => variant.language === language).map(({env}) => env),
        }

  return config !== undefined && hasManagedInitContainerShape(container, config.mountPath) ? config : undefined
}

const hasManagedInitContainerShape = (container: InitContainer, mountPath: string): boolean =>
  container.name === TRACER_CONTAINER_NAME &&
  container.command?.length === 1 &&
  container.command[0] === '/datadog-init/copy-lib.sh' &&
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
  command: ['/datadog-init/copy-lib.sh'],
  args: [mountPath],
  resources: {cpu: 0.25, memory: '0.5Gi', ephemeralStorage: '1Gi'},
  volumeMounts: [{volumeName: TRACER_VOLUME_NAME, mountPath}],
})
