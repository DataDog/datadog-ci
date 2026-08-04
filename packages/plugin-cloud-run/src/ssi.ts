import type {IContainer, IEnvVar} from './types'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language, SingleLanguageTracerRegistry} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_REGISTRY,
  DEFAULT_TRACER_VERSION,
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
  getLanguageCompatibilityError,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {LANGUAGE_METADATA} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

export const TRACER_INJECTION_LANGUAGES: readonly Language[] = Object.keys(LANGUAGE_METADATA) as Language[]
export const CLOUD_RUN_LANGUAGES = [...TRACER_INJECTION_LANGUAGES, 'go'] as const

export type CloudRunLanguage = (typeof CLOUD_RUN_LANGUAGES)[number]

export const NORMALIZED_TRACING_MODES = ['manual', 'disabled', 'inject'] as const
export type TracingMode = (typeof NORMALIZED_TRACING_MODES)[number]

export interface SsiOptions {
  language: CloudRunLanguage | undefined
  tracing: TracingMode | undefined
  tracerVersion: string
  tracerRegistry: SingleLanguageTracerRegistry
  tracerLibc: Libc
}

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'}
  | {
      kind: 'single-language'
      language: Language
      libc: Libc
      spec: LanguageInjectionSpec
    }
) & {warnings: readonly string[]}

/** Resolves SSI inputs to a mode or validation errors. */
export const resolveSsiConfig = (options: SsiOptions): SsiConfigResult => {
  if (options.tracing !== 'inject') {
    const unusedFlags = nonDefaultTracerFlags(options)

    return unusedFlags.length > 0
      ? {
          kind: 'errors',
          errors: [`${unusedFlags.join(', ')} only applies with --tracing inject.`],
          warnings: [],
        }
      : {kind: 'no-injection', warnings: []}
  }

  if (options.language === undefined) {
    return {
      kind: 'errors',
      errors: [
        `--tracing inject requires --language until automatic multi-language injection is supported. Possible values: ${TRACER_INJECTION_LANGUAGES.join(
          ', '
        )}.`,
      ],
      warnings: [],
    }
  }

  if (options.language === 'go') {
    return {
      kind: 'errors',
      errors: [
        'Go does not support tracer injection. Instrument the application with dd-trace-go and use --tracing manual.',
      ],
      warnings: [],
    }
  }

  const compatibilityError = getLanguageCompatibilityError({
    language: options.language,
    libc: options.tracerLibc,
    version: options.tracerVersion,
  })
  const errors = compatibilityError === undefined ? [] : [compatibilityError]
  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings: []}
  }

  const spec = getLanguageInjectionSpec({
    language: options.language,
    registry: options.tracerRegistry,
    version: options.tracerVersion,
    libc: options.tracerLibc,
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
    libc: options.tracerLibc,
    spec,
  }
}

/** Selects the ingress application container or rejects an ambiguous layout. */
export const selectIngressContainer = (
  containers: readonly IContainer[],
  reservedNames: ReadonlySet<string>
): IContainer => {
  const candidates = containers.filter((container) => !container.name || !reservedNames.has(container.name))
  if (candidates.length === 0) {
    throw new SsiConfigError('No application container was found to instrument.')
  }

  const withPorts = candidates.filter((container) => (container.ports ?? []).length > 0)
  if (withPorts.length === 1) {
    return withPorts[0]
  }
  if (withPorts.length > 1) {
    throw new SsiConfigError(
      `Multiple containers declare ports, so the ingress container is ambiguous: ${withPorts
        .map((container) => container.name || '<unnamed>')
        .join(', ')}. Cloud Run allows exactly one ingress container.`
    )
  }
  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new SsiConfigError(
    `No container declares ports, so the ingress container is ambiguous: ${candidates
      .map((container) => container.name || '<unnamed>')
      .join(', ')}. Declare a container port on your ingress container.`
  )
}

export const mergeLanguageInjectionEnv = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  spec: LanguageInjectionSpec
): IEnvVar[] => {
  const env = existingEnv ?? []
  assertLanguageInjectionEnvCanBeMerged(env, spec)
  const merged = spec.env.reduce<IEnvVar[]>(
    (current, fragment) => {
      const existing = findEnv(current, fragment.name)

      return upsertEnv(current, fragment.name, mergeLanguageEnvFragment(existing?.value ?? undefined, fragment))
    },
    [...env]
  )
  const existingTags = findEnv(merged, DD_TAGS_ENV_VAR)

  return upsertEnv(merged, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value ?? undefined))
}

/** Removes exact tracer fragments for every supported language so replacing a tracer cannot leave stale settings. */
export const removeLanguageInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] =>
  (existingEnv ?? []).flatMap((variable) => {
    if (!variable.name || variable.valueSource || !variable.value) {
      return [variable]
    }

    const fragments = LANGUAGE_ENV_FRAGMENTS.filter((fragment) => fragment.name === variable.name)
    const withoutTag = variable.name === DD_TAGS_ENV_VAR ? removeInjectionModeTag(variable.value) : variable.value
    const value = fragments.reduce<string | undefined>(removeEnvFragment, withoutTag)

    return value === undefined ? [] : [value === variable.value ? variable : {...variable, value}]
  })

const findEnv = (env: readonly IEnvVar[], name: string): IEnvVar | undefined =>
  env.find((variable) => variable.name === name)

const assertLanguageInjectionEnvCanBeMerged = (env: readonly IEnvVar[], spec: LanguageInjectionSpec): void => {
  const targetNames = new Set([...spec.env.map((fragment) => fragment.name), DD_TAGS_ENV_VAR])
  for (const name of targetNames) {
    const matching = env.filter((variable) => variable.name === name)
    if (matching.length > 1) {
      throw new SsiConfigError(
        `${name} appears more than once on the ingress container, so Datadog cannot safely modify it. Remove the duplicate before retrying.`
      )
    }
    if (matching[0]?.valueSource) {
      throw new SsiConfigError(
        `${name} on the ingress container is populated from a secret reference, which Datadog cannot safely extend. Set it to a literal value or remove it before instrumenting.`
      )
    }
  }
}

const upsertEnv = (env: readonly IEnvVar[], name: string, value: string): IEnvVar[] => {
  const index = env.findIndex((variable) => variable.name === name)

  return index === -1
    ? [...env, {name, value}]
    : env.map((variable, variableIndex) => (variableIndex === index ? {...variable, value} : variable))
}

const mergeLanguageEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string => {
  try {
    return mergeEnvFragment(currentValue, fragment)
  } catch (error) {
    throw new SsiConfigError(error instanceof Error ? error.message : String(error))
  }
}

const LANGUAGE_ENV_FRAGMENTS: readonly EnvFragment[] = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
  LIBCS.filter(
    (libc) => getLanguageCompatibilityError({language, libc, version: DEFAULT_TRACER_VERSION}) === undefined
  ).flatMap(
    (libc) =>
      getLanguageInjectionSpec({
        language,
        libc,
        registry: DEFAULT_TRACER_REGISTRY,
        version: DEFAULT_TRACER_VERSION,
        root: TRACER_MOUNT_PATH,
      }).env
  )
)

/** Returns tracer flags whose values differ from their defaults. */
const nonDefaultTracerFlags = (options: SsiOptions): string[] =>
  [
    options.tracerVersion !== DEFAULT_TRACER_VERSION ? '--tracer-version' : undefined,
    options.tracerRegistry !== DEFAULT_TRACER_REGISTRY ? '--tracer-registry' : undefined,
    options.tracerLibc !== DEFAULT_TRACER_LIBC ? '--tracer-libc' : undefined,
  ].filter((flag): flag is string => flag !== undefined)

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}
