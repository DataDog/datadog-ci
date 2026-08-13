import type {IContainer, IEnvVar} from './types'
import type {CloudRunLanguage, TracingInput, TracingMode} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {
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


export interface SsiOptions {
  readonly language: CloudRunLanguage | undefined
  readonly tracing: TracingMode | undefined
  readonly tracerVersion: string | undefined
  readonly tracerLibc: Libc | undefined
}

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'; tracing: Exclude<TracingMode, 'inject'> | undefined}
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
    return {
      kind: 'errors',
      errors: ['--tracing inject requires --language until automatic multi-language injection is supported.'],
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
  }
}

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
        `${name} appears more than once on the main container, so datadog-ci cannot safely add automatic instrumentation. Remove the duplicate before retrying.`
      )
    }
    if (matching[0]?.valueSource) {
      throw new SsiConfigError(
        `${name} on the main container comes from a secret reference, so datadog-ci cannot safely add automatic instrumentation. Set it to a literal value or remove it before retrying.`
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
  ].filter((flag): flag is string => flag !== undefined)

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}
