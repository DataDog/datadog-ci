import type {IContainer} from './types'
import type {LanguageInjectionSpec, Libc} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {Language, SingleLanguageTracerRegistry} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_REGISTRY,
  DEFAULT_TRACER_SIDECAR_MEMORY,
  DEFAULT_TRACER_VERSION,
  DEFAULT_TRACER_VOLUME_SIZE,
  TRACER_MOUNT_PATH,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {
  getLanguageCompatibilityError,
  getLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {LANGUAGE_METADATA} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

export const TRACER_INJECTION_LANGUAGES: readonly Language[] = Object.keys(LANGUAGE_METADATA) as Language[]
export const CLOUD_RUN_LANGUAGES = [...TRACER_INJECTION_LANGUAGES, 'go'] as const

export type CloudRunLanguage = (typeof CLOUD_RUN_LANGUAGES)[number]

export interface SsiOptions {
  apmEnabled: boolean
  language: CloudRunLanguage | undefined
  tracing: string | undefined
  tracerVersion: string
  tracerRegistry: SingleLanguageTracerRegistry
  libc: Libc
  tracerVolumeSize: string
  tracerSidecarMemory: string
}

export type SsiConfigResult =
  | {kind: 'errors'; errors: readonly string[]; warnings: readonly string[]}
  | {kind: 'disabled'; warnings: readonly string[]}
  | {kind: 'agent-only'; warnings: readonly string[]}
  | {
      kind: 'single-language'
      warnings: readonly string[]
      language: Language
      libc: Libc
      spec: LanguageInjectionSpec
      tracerVolumeSize: string
      tracerSidecarMemory: string
    }

/** Resolves SSI inputs to a mode or validation errors. */
export const resolveSsiConfig = (options: SsiOptions): SsiConfigResult => {
  if (!options.apmEnabled) {
    const ignored = customTracerFlags(options)

    return ignored.length > 0
      ? {
          kind: 'errors',
          errors: [
            `${ignored.join(
              ', '
            )} only applies when --apm-enabled is set. Add --apm-enabled, or remove these flags to avoid silently changing nothing.`,
          ],
          warnings: [],
        }
      : {kind: 'disabled', warnings: []}
  }

  const tracingErrors =
    toBoolean(options.tracing) === false
      ? ['--apm-enabled cannot be combined with disabled tracing. Remove one of the two flags.']
      : []

  if (options.language === undefined) {
    return {
      kind: 'errors',
      errors: [
        ...tracingErrors,
        `--apm-enabled requires --language. Multi-Language instrumentation is not supported yet. Supported Single-Language values are: ${TRACER_INJECTION_LANGUAGES.join(
          ', '
        )}, plus "go" for agent-only tracing.`,
      ],
      warnings: [],
    }
  }

  if (options.language === 'go') {
    const ignored = customTracerFlags(options)
    const goErrors = [
      ...tracingErrors,
      ...(ignored.length > 0
        ? [
            `${ignored.join(', ')} cannot be used with --language go because Go does not use an SSI tracer image. Remove these flags.`,
          ]
        : []),
    ]
    const goWarnings = [
      'Go does not support automatic tracer injection. Datadog is setting DD_TRACE_ENABLED=true so the Datadog Agent sidecar can collect traces, but no tracer is installed. Instrument your Go application with dd-trace-go and redeploy your image to get traces.',
    ]

    return goErrors.length > 0
      ? {kind: 'errors', errors: goErrors, warnings: goWarnings}
      : {kind: 'agent-only', warnings: goWarnings}
  }

  const compatibilityError = getLanguageCompatibilityError({
    language: options.language,
    libc: options.libc,
    version: options.tracerVersion,
  })
  const errors = [...tracingErrors, ...(compatibilityError === undefined ? [] : [compatibilityError])]
  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings: []}
  }

  const spec = getLanguageInjectionSpec({
    language: options.language,
    registry: options.tracerRegistry,
    version: options.tracerVersion,
    libc: options.libc,
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
    libc: options.libc,
    spec,
    tracerVolumeSize: options.tracerVolumeSize,
    tracerSidecarMemory: options.tracerSidecarMemory,
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

export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}

const customTracerFlags = (options: SsiOptions): string[] =>
  [
    options.tracerVersion !== DEFAULT_TRACER_VERSION ? '--tracer-version' : undefined,
    options.tracerRegistry !== DEFAULT_TRACER_REGISTRY ? '--tracer-registry' : undefined,
    options.libc !== DEFAULT_TRACER_LIBC ? '--libc' : undefined,
    options.tracerVolumeSize !== DEFAULT_TRACER_VOLUME_SIZE ? '--tracer-volume-size' : undefined,
    options.tracerSidecarMemory !== DEFAULT_TRACER_SIDECAR_MEMORY ? '--tracer-sidecar-memory' : undefined,
  ].filter((flag): flag is string => flag !== undefined)
