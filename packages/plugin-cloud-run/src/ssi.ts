import type {IContainer} from './types'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language, SingleLanguageTracerRegistry} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_REGISTRY,
  DEFAULT_TRACER_VERSION,
} from '@datadog/datadog-ci-base/commands/cloud-run/constants'
import {TRACER_MOUNT_PATH} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
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
