import type {IContainer, IEnvVar} from './types'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language, SingleLanguageTracerRegistry} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'
import {DD_TAGS_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_REGISTRY,
  DEFAULT_TRACER_VERSION,
} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeEnvFragment,
  removeInjectionModeTag,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  getLanguageCompatibilityErrors,
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

  const errors = getLanguageCompatibilityErrors({
    language: options.language,
    libc: options.tracerLibc,
    version: options.tracerVersion,
  })
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

/** Selects the main application container or rejects an ambiguous layout. */
export const selectMainContainer = (
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
      `Multiple containers declare ports, so the main container is ambiguous: ${withPorts
        .map((container) => container.name || '<unnamed>')
        .join(', ')}. Cloud Run allows exactly one main container.`
    )
  }
  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new SsiConfigError(
    `No container declares ports, so the main container is ambiguous: ${candidates
      .map((container) => container.name || '<unnamed>')
      .join(', ')}. Declare a container port on your main container.`
  )
}

const findEnv = (env: readonly IEnvVar[], name: string): IEnvVar | undefined =>
  env.find((variable) => variable.name === name)

const assertUniqueTargetEnvNames = (env: readonly IEnvVar[], targetNames: ReadonlySet<string>): void => {
  for (const name of targetNames) {
    if (env.filter((variable) => variable.name === name).length > 1) {
      throw new SsiValidationError(
        `${name} appears more than once on the ingress container, so Datadog cannot safely modify it. Remove the duplicate before retrying.`
      )
    }
  }
}

const assertNoValueSource = (existing: IEnvVar | undefined, name: string): void => {
  if (existing?.valueSource) {
    throw new SsiValidationError(
      `${name} on the ingress container is populated from a secret reference, which Datadog cannot safely extend. Set it to a literal value or remove it before instrumenting.`
    )
  }
}

export const assertNativeInjectionEnvCanBeMerged = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  spec: SingleLanguageInjectionSpec
): void => {
  const env = existingEnv ?? []
  const targetNames = new Set([...spec.env.map((fragment) => fragment.name), DD_TAGS_ENV_VAR])
  assertUniqueTargetEnvNames(env, targetNames)
  for (const name of targetNames) {
    assertNoValueSource(findEnv(env, name), name)
  }
}

const upsertEnv = (env: IEnvVar[], name: string, value: string): IEnvVar[] => {
  const index = env.findIndex((variable) => variable.name === name)
  if (index === -1) {
    return [...env, {name, value}]
  }
  const updated = [...env]
  updated[index] = {...updated[index], value}

  return updated
}

export const mergeNativeInjectionEnv = (
  existingEnv: readonly IEnvVar[] | null | undefined,
  spec: SingleLanguageInjectionSpec
): IEnvVar[] => {
  let env: IEnvVar[] = [...(existingEnv ?? [])]
  assertNativeInjectionEnvCanBeMerged(env, spec)

  for (const fragment of spec.env) {
    const existing = findEnv(env, fragment.name)
    env = upsertEnv(env, fragment.name, mergeEnvFragment(existing?.value ?? undefined, fragment))
  }

  const existingTags = findEnv(env, DD_TAGS_ENV_VAR)
  env = upsertEnv(env, DD_TAGS_ENV_VAR, mergeInjectionModeTag(existingTags?.value ?? undefined))

  return env
}

const KNOWN_NATIVE_FRAGMENTS: readonly EnvFragment[] = (() => {
  const fragments = new Map<string, EnvFragment>()
  for (const language of SINGLE_LANGUAGE_VALUES) {
    for (const libc of ['glibc', 'musl'] as const) {
      if (language === 'ruby' && libc === 'musl') {
        continue
      }
      const spec = getSingleLanguageInjectionSpec({
        language,
        libc,
        registry: DEFAULT_TRACER_REGISTRY,
        version: DEFAULT_TRACER_VERSION,
        root: TRACER_MOUNT_PATH,
      })
      for (const fragment of spec.env) {
        fragments.set(JSON.stringify(fragment), fragment)
      }
    }
  }

  return [...fragments.values()]
})()

const KNOWN_NATIVE_FRAGMENTS_BY_NAME = new Map<string, EnvFragment[]>()
for (const fragment of KNOWN_NATIVE_FRAGMENTS) {
  const fragments = KNOWN_NATIVE_FRAGMENTS_BY_NAME.get(fragment.name) ?? []
  fragments.push(fragment)
  KNOWN_NATIVE_FRAGMENTS_BY_NAME.set(fragment.name, fragments)
}

/** Removes every exact native SSI fragment and the injection-mode tag, regardless of selected language or libc. */
export const removeKnownNativeInjectionEnv = (existingEnv: readonly IEnvVar[] | null | undefined): IEnvVar[] => {
  const cleaned: IEnvVar[] = []
  for (const variable of existingEnv ?? []) {
    if (!variable.name || variable.valueSource || typeof variable.value !== 'string' || variable.value === '') {
      cleaned.push(variable)
      continue
    }

    let value: string | undefined = variable.value
    if (variable.name === DD_TAGS_ENV_VAR) {
      value = removeInjectionModeTag(value)
    }
    for (const fragment of KNOWN_NATIVE_FRAGMENTS_BY_NAME.get(variable.name) ?? []) {
      value = removeEnvFragment(value, fragment)
    }

    if (value !== undefined) {
      cleaned.push(value === variable.value ? variable : {...variable, value})
    }
  }

  return cleaned
}

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}

/** Returns tracer flags whose values differ from their defaults. */
const nonDefaultTracerFlags = (options: SsiOptions): string[] =>
  [
    options.tracerVersion !== DEFAULT_TRACER_VERSION ? '--tracer-version' : undefined,
    options.tracerRegistry !== DEFAULT_TRACER_REGISTRY ? '--tracer-registry' : undefined,
    options.tracerLibc !== DEFAULT_TRACER_LIBC ? '--tracer-libc' : undefined,
  ].filter((flag): flag is string => flag !== undefined)
