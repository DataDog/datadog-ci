import type {IContainer, IEnvVar} from './types'
import type {
  CloudRunLanguage,
  TracerVolumeMedium,
  TracingInput,
  TracingMode,
} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {
  CLOUD_RUN_LANGUAGES,
  CLOUD_RUN_TRACER_REGISTRY,
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_VERSION,
  TRACING_MODE_BY_INPUT,
} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import {DD_TAGS_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeEnvFragment,
  removeInjectionModeTag,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  LIBCS,
  getLanguageCompatibilityErrors,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {TRACER_INJECTION_LANGUAGES} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

export const COMPOSITE_TRACER_IMAGE = 'gcr.io/datadoghq/dd-lib-composite-init:latest'
export const COMPOSITE_TRACER_MOUNT_PATH = '/opt/datadog-packages'
export const COMPOSITE_TRACER_COMPLETION_MARKER = `${COMPOSITE_TRACER_MOUNT_PATH}/.datadog-composite-copy-finished`

const COMPOSITE_ENV_FRAGMENTS: readonly EnvFragment[] = [
  {
    name: 'LD_PRELOAD',
    value: `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so`,
    separator: ' ',
    mode: 'prepend',
  },
  {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless', mode: 'set-if-absent'},
]

export interface SsiOptions {
  readonly language: string | undefined
  readonly tracing: TracingMode | undefined
  readonly tracerVersion: string | undefined
  readonly tracerLibc: Libc | undefined
  readonly tracerVolumeMedium: TracerVolumeMedium | undefined
}

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'; tracing: Exclude<TracingMode, 'inject'> | undefined}
  | {
      kind: 'single-language'
      language: Language
      libc: Libc
      spec: LanguageInjectionSpec
      tracerVolumeMedium: TracerVolumeMedium
    }
  | {kind: 'multi-language'; tracerVolumeMedium: TracerVolumeMedium}
) & {warnings: readonly string[]}

/** Resolves SSI inputs to a mode or validation errors. */
export const resolveSsiConfig = (options: SsiOptions): SsiConfigResult => {
  if (options.tracing !== 'inject') {
    const unusedFlags = tracerFlags(options)

    return unusedFlags.length > 0
      ? {
          kind: 'errors',
          errors: [
            `Tracer options ${unusedFlags.join(', ')} require --tracing inject. Remove these options or use --tracing inject.`,
          ],
          warnings: [],
        }
      : {kind: 'no-injection', tracing: options.tracing, warnings: []}
  }

  if (options.language === undefined) {
    const unsupportedFlags = [
      options.tracerVersion !== undefined ? '--tracer-version' : undefined,
      options.tracerLibc !== undefined ? '--tracer-libc' : undefined,
    ].filter((flag): flag is string => flag !== undefined)

    return unsupportedFlags.length > 0
      ? {
          kind: 'errors',
          errors: [
            `${unsupportedFlags.join(', ')} ${
              unsupportedFlags.length === 1 ? 'requires' : 'require'
            } --language because automatic language detection cannot apply per-language tracer settings. Add --language or remove these options.`,
          ],
          warnings: [],
        }
      : {
          kind: 'multi-language',
          tracerVolumeMedium: options.tracerVolumeMedium ?? 'memory',
          warnings: [],
        }
  }

  if (!isCloudRunLanguage(options.language)) {
    return {
      kind: 'errors',
      errors: [
        `Automatic instrumentation does not support language ${JSON.stringify(
          options.language
        )}. Use one of ${TRACER_INJECTION_LANGUAGES.map((language) => JSON.stringify(language)).join(
          ', '
        )}, or omit --language to detect it automatically.`,
      ],
      warnings: [],
    }
  }

  if (!isCloudRunLanguage(options.language)) {
    return {
      kind: 'errors',
      errors: [
        `Automatic instrumentation does not support language ${JSON.stringify(
          options.language
        )}. Use one of ${TRACER_INJECTION_LANGUAGES.map((language) => JSON.stringify(language)).join(', ')}.`,
      ],
      warnings: [],
    }
  }

  if (options.language === 'go') {
    return {
      kind: 'errors',
      errors: [
        'Go automatic instrumentation is not supported. Instrument the application with dd-trace-go and use --tracing manual.',
      ],
      warnings: [],
    }
  }

  const tracerVersion = options.tracerVersion ?? DEFAULT_TRACER_VERSION
  const tracerLibc = options.tracerLibc ?? DEFAULT_TRACER_LIBC
  const tracerVolumeMedium = options.tracerVolumeMedium ?? 'memory'
  const errors = getLanguageCompatibilityErrors({
    language: options.language,
    libc: tracerLibc,
    version: tracerVersion,
  })
  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings: []}
  }

  const spec = getLanguageInjectionSpec({
    language: options.language,
    registry: CLOUD_RUN_TRACER_REGISTRY,
    version: tracerVersion,
    libc: tracerLibc,
    root: TRACER_MOUNT_PATH,
  })
  const warnings =
    options.language === 'java'
      ? [
          'This release supports Java 8 through Java 23. Java 24+ applications require an additional JVM flag that datadog-ci cannot set safely without knowing your runtime version.',
        ]
      : []

  return {
    kind: 'single-language',
    warnings,
    language: options.language,
    libc: tracerLibc,
    spec,
    tracerVolumeMedium,
  }
}

const isCloudRunLanguage = (language: string): language is CloudRunLanguage =>
  CLOUD_RUN_LANGUAGES.some((supportedLanguage) => supportedLanguage === language)

export const normalizeTracingMode = (tracing: TracingInput | undefined): TracingMode | undefined =>
  tracing === undefined ? undefined : TRACING_MODE_BY_INPUT[tracing]

export const getTracingEnvValue = (tracing: TracingInput | undefined): 'true' | 'false' | '1' | '0' | undefined => {
  if (tracing === undefined) {
    return undefined
  }

  if (tracing === '1' || tracing === '0') {
    return tracing
  }

  return tracing === 'false' || tracing === 'disabled' ? 'false' : 'true'
}

/** Selects the main application container or rejects an ambiguous layout. */
export const selectMainContainer = (
  containers: readonly IContainer[],
  reservedNames: ReadonlySet<string>
): IContainer => {
  const candidates = containers.filter((container) => !container.name || !reservedNames.has(container.name))
  if (candidates.length === 0) {
    throw new SsiConfigError(
      'Cannot enable automatic instrumentation because no application container was found. Add an application container, or choose a different --sidecar-name if it matches your application container.'
    )
  }

  const withPorts = candidates.filter((container) => (container.ports ?? []).length > 0)
  if (withPorts.length === 1) {
    return withPorts[0]
  }
  if (withPorts.length > 1) {
    throw new SsiConfigError(
      `Cannot identify the main application container because multiple containers declare ports: ${withPorts
        .map((container) => container.name || '<unnamed>')
        .join(', ')}. Configure only the main application container with a port, then retry.`
    )
  }
  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new SsiConfigError(
    `Cannot identify the main application container because none of these containers declares a port: ${candidates
      .map((container) => container.name || '<unnamed>')
      .join(', ')}. Declare a port on the main application container, then retry.`
  )
}

export const assertInjectionEnvCanBeMerged = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  config: Extract<SsiConfigResult, {kind: 'single-language' | 'multi-language'}>
): void => {
  const env = existingEnv ?? []
  if (config.kind === 'single-language') {
    assertEnvCanBeMerged(env, config.spec.env, [DD_TAGS_ENV_VAR])
  } else {
    assertEnvCanBeMerged(env, COMPOSITE_ENV_FRAGMENTS)
  }
}

export const mergeLanguageInjectionEnv = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  spec: LanguageInjectionSpec
): IEnvVar[] => {
  const env = existingEnv ?? []
  assertEnvCanBeMerged(env, spec.env, [DD_TAGS_ENV_VAR])
  const merged = spec.env.reduce<IEnvVar[]>(
    (current, fragment) => {
      const existing = findEnv(current, fragment.name)

      return upsertEnv(current, fragment.name, mergeInjectionEnvFragment(existing?.value ?? undefined, fragment))
    },
    [...env]
  )
  const existingTags = findEnv(merged, DD_TAGS_ENV_VAR)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value ?? undefined))
}

export const mergeCompositeInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] => {
  const env = existingEnv ?? []
  assertEnvCanBeMerged(env, COMPOSITE_ENV_FRAGMENTS)

  return COMPOSITE_ENV_FRAGMENTS.reduce<IEnvVar[]>(
    (current, fragment) => {
      const existing = findEnv(current, fragment.name)

      return upsertEnv(current, fragment.name, mergeInjectionEnvFragment(existing?.value ?? undefined, fragment))
    },
    [...env]
  )
}

export const removeSingleLanguageInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] =>
  removeEnvFragments(existingEnv, LANGUAGE_ENV_FRAGMENTS, true)

export const removeCompositeInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] =>
  removeEnvFragments(existingEnv, COMPOSITE_ENV_FRAGMENTS, false)

/** Removes exact tracer fragments for every supported injection mode during full uninstrumentation. */
export const removeInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] =>
  removeEnvFragments(existingEnv, [...LANGUAGE_ENV_FRAGMENTS, ...COMPOSITE_ENV_FRAGMENTS], true)

const removeEnvFragments = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  ownedFragments: readonly EnvFragment[],
  removeTag: boolean
): IEnvVar[] =>
  (existingEnv ?? []).flatMap((variable) => {
    if (!variable.name || variable.valueSource || !variable.value) {
      return [variable]
    }

    const fragments = ownedFragments.filter((fragment) => fragment.name === variable.name)
    const withoutTag =
      removeTag && variable.name === DD_TAGS_ENV_VAR ? removeInjectionModeTag(variable.value) : variable.value
    const value = fragments.reduce<string | undefined>(removeEnvFragment, withoutTag)

    return value === undefined ? [] : [value === variable.value ? variable : {...variable, value}]
  })

const findEnv = (env: readonly IEnvVar[], name: string): IEnvVar | undefined =>
  env.find((variable) => variable.name === name)

const assertEnvCanBeMerged = (
  env: readonly IEnvVar[],
  fragments: readonly EnvFragment[],
  extraNames: readonly string[] = []
): void => {
  const targetNames = new Set([...fragments.map((fragment) => fragment.name), ...extraNames])
  for (const name of targetNames) {
    const matching = env.filter((variable) => variable.name === name)
    if (matching.length > 1) {
      throw new SsiConfigError(
        `${name} appears more than once on the main container, so datadog-ci cannot safely add automatic instrumentation. Remove the duplicate before retrying.`
      )
    }
    if (matching[0]?.valueSource) {
      throw new SsiConfigError(
        `${name} on the main container comes from a secret reference, so datadog-ci cannot safely add automatic instrumentation. Set it to a literal value or remove it before retrying.`
      )
    }
  }

  for (const fragment of fragments) {
    mergeInjectionEnvFragment(findEnv(env, fragment.name)?.value ?? undefined, fragment)
  }
}

const upsertEnv = (env: readonly IEnvVar[], name: string, value: string): IEnvVar[] => {
  const index = env.findIndex((variable) => variable.name === name)

  return index === -1
    ? [...env, {name, value}]
    : env.map((variable, variableIndex) => (variableIndex === index ? {...variable, value} : variable))
}

const mergeInjectionEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string => {
  try {
    return mergeEnvFragment(currentValue, fragment)
  } catch (error) {
    throw new SsiConfigError(
      `Cannot enable automatic instrumentation while updating ${fragment.name}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

const LANGUAGE_ENV_FRAGMENTS: readonly EnvFragment[] = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
  LIBCS.filter(
    (libc) => getLanguageCompatibilityErrors({language, libc, version: DEFAULT_TRACER_VERSION}).length === 0
  ).flatMap(
    (libc) =>
      getLanguageInjectionSpec({
        language,
        libc,
        registry: CLOUD_RUN_TRACER_REGISTRY,
        version: DEFAULT_TRACER_VERSION,
        root: TRACER_MOUNT_PATH,
      }).env
  )
)

const tracerFlags = (options: SsiOptions): string[] =>
  [
    options.tracerVersion !== undefined ? '--tracer-version' : undefined,
    options.tracerLibc !== undefined ? '--tracer-libc' : undefined,
    options.tracerVolumeMedium !== undefined ? '--tracer-volume-medium' : undefined,
  ].filter((flag): flag is string => flag !== undefined)

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}
