import type {IContainer} from './types'
import type {
  ServerlessLibc,
  SingleLanguageInjectionSpec,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import type {ServerlessLanguage} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {
  DEFAULT_TRACER_LIBC,
  DEFAULT_TRACER_REGISTRY,
  DEFAULT_TRACER_SIDECAR_MEMORY,
  DEFAULT_TRACER_VERSION,
  DEFAULT_TRACER_VOLUME_SIZE,
  TRACER_MOUNT_PATH,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {getSingleLanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {SINGLE_LANGUAGE_TRACER_REGISTRIES} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

/** Languages accepted by `--language` today. `go` is accepted for APM as an agent-only mode. */
export const CLOUD_RUN_LANGUAGES = ['nodejs', 'python', 'go', 'java', 'csharp', 'ruby', 'php'] as const
export const SINGLE_LANGUAGE_VALUES: readonly ServerlessLanguage[] = [
  'java',
  'nodejs',
  'csharp',
  'python',
  'ruby',
  'php',
]

export class SsiValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiValidationError'
  }
}

export interface SsiFlagOptions {
  apmEnabled: boolean
  language: string | undefined
  tracing: string | undefined
  tracerVersion: string
  tracerRegistry: string
  libc: string
  tracerVolumeSize: string
  tracerSidecarMemory: string
}

export type SsiFlagValidation =
  | {kind: 'errors'; errors: string[]; warnings: string[]}
  | {kind: 'disabled'; warnings: string[]}
  | {kind: 'go-agent-only'; warnings: string[]}
  | {
      kind: 'single-language'
      warnings: string[]
      language: ServerlessLanguage
      libc: ServerlessLibc
      spec: SingleLanguageInjectionSpec
      tracerVolumeSize: string
      tracerSidecarMemory: string
    }

const CLOUD_RUN_QUANTITY_REG_EXP = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti|k|M|G|T)?$/
const CLOUD_RUN_QUANTITY_MULTIPLIERS: Record<string, number> = {
  '': 1,
  m: 0.001,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  k: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
}

export const cloudRunQuantityToBytes = (value: string): number | undefined => {
  const match = typeof value === 'string' ? value.trim().match(CLOUD_RUN_QUANTITY_REG_EXP) : undefined
  if (!match) {
    return undefined
  }
  const quantity = Number(match[1]) * CLOUD_RUN_QUANTITY_MULTIPLIERS[match[2] ?? '']

  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined
}

export const validateCloudRunQuantity = (value: string, flag: string): string => {
  if (cloudRunQuantityToBytes(value) === undefined) {
    return `${flag} must be a positive Cloud Run quantity such as 768Mi or 1Gi, got ${JSON.stringify(value)}.`
  }

  return ''
}

const nonDefaultTracerFlags = (options: SsiFlagOptions): string[] => {
  const nonDefault: string[] = []
  if (options.tracerVersion !== DEFAULT_TRACER_VERSION) {
    nonDefault.push('--tracer-version')
  }
  if (options.tracerRegistry !== DEFAULT_TRACER_REGISTRY) {
    nonDefault.push('--tracer-registry')
  }
  if (options.libc !== DEFAULT_TRACER_LIBC) {
    nonDefault.push('--libc')
  }
  if (options.tracerVolumeSize !== DEFAULT_TRACER_VOLUME_SIZE) {
    nonDefault.push('--tracer-volume-size')
  }
  if (options.tracerSidecarMemory !== DEFAULT_TRACER_SIDECAR_MEMORY) {
    nonDefault.push('--tracer-sidecar-memory')
  }

  return nonDefault
}

export const validateSsiFlags = (options: SsiFlagOptions): SsiFlagValidation => {
  const errors: string[] = []
  const warnings: string[] = []

  if (!options.apmEnabled) {
    const ignored = nonDefaultTracerFlags(options)
    if (ignored.length > 0) {
      errors.push(
        `${ignored.join(
          ', '
        )} only applies when --apm-enabled is set. Add --apm-enabled, or remove these flags to avoid silently changing nothing.`
      )
    }

    return errors.length > 0 ? {kind: 'errors', errors, warnings} : {kind: 'disabled', warnings}
  }

  if (options.tracing === 'false') {
    errors.push('--apm-enabled cannot be combined with --tracing false. Remove one of the two flags.')
  }

  const language = options.language
  if (!language) {
    errors.push(
      `--apm-enabled requires --language. Multi-Language instrumentation is not supported yet (SVLS-9316). Supported Single-Language values are: ${SINGLE_LANGUAGE_VALUES.join(
        ', '
      )}, plus "go" for agent-only tracing.`
    )

    return {kind: 'errors', errors, warnings}
  }

  if (!(CLOUD_RUN_LANGUAGES as readonly string[]).includes(language)) {
    errors.push(
      `Unsupported --language value ${JSON.stringify(language)}. Possible values: ${CLOUD_RUN_LANGUAGES.join(', ')}.`
    )

    return {kind: 'errors', errors, warnings}
  }

  if (language === 'go') {
    const ignored = nonDefaultTracerFlags(options)
    if (ignored.length > 0) {
      errors.push(
        `${ignored.join(', ')} cannot be used with --language go because Go does not use an SSI tracer image. Remove these flags.`
      )
    }
    warnings.push(
      'Go does not support automatic tracer injection. Datadog is setting DD_TRACE_ENABLED=true so the Datadog Agent sidecar can collect traces, but no tracer is installed. Instrument your Go application with dd-trace-go and redeploy your image to get traces.'
    )

    return errors.length > 0 ? {kind: 'errors', errors, warnings} : {kind: 'go-agent-only', warnings}
  }

  for (const [flag, value] of [
    ['--tracer-volume-size', options.tracerVolumeSize],
    ['--tracer-sidecar-memory', options.tracerSidecarMemory],
  ] as const) {
    const error = validateCloudRunQuantity(value, flag)
    if (error) {
      errors.push(error)
    }
  }

  if (!(SINGLE_LANGUAGE_TRACER_REGISTRIES as readonly string[]).includes(options.tracerRegistry)) {
    errors.push(
      `Unsupported --tracer-registry ${JSON.stringify(
        options.tracerRegistry
      )}. Possible values: ${SINGLE_LANGUAGE_TRACER_REGISTRIES.join(', ')}.`
    )
  }

  if (options.libc !== 'glibc' && options.libc !== 'musl') {
    errors.push(`Unsupported --libc ${JSON.stringify(options.libc)}. Possible values: glibc, musl.`)
  }

  const volumeBytes = cloudRunQuantityToBytes(options.tracerVolumeSize)
  const sidecarMemoryBytes = cloudRunQuantityToBytes(options.tracerSidecarMemory)
  if (volumeBytes !== undefined && sidecarMemoryBytes !== undefined && sidecarMemoryBytes < volumeBytes) {
    errors.push(
      `--tracer-sidecar-memory (${options.tracerSidecarMemory}) cannot be smaller than --tracer-volume-size (${options.tracerVolumeSize}) because the Memory volume is charged to the tracer copy sidecar.`
    )
  }

  if (errors.length > 0) {
    return {kind: 'errors', errors, warnings}
  }

  let spec: SingleLanguageInjectionSpec
  try {
    spec = getSingleLanguageInjectionSpec({
      language: language as ServerlessLanguage,
      registry: options.tracerRegistry as (typeof SINGLE_LANGUAGE_TRACER_REGISTRIES)[number],
      version: options.tracerVersion,
      libc: options.libc as ServerlessLibc,
      root: TRACER_MOUNT_PATH,
    })
  } catch (error) {
    return {kind: 'errors', errors: [error instanceof Error ? error.message : String(error)], warnings}
  }

  if (language === 'java') {
    warnings.push(
      'This release supports Java 8 through Java 23. Java 24+ applications require an additional JVM flag that datadog-ci cannot set safely without knowing your runtime version.'
    )
  }

  return {
    kind: 'single-language',
    warnings,
    language: language as ServerlessLanguage,
    libc: options.libc as ServerlessLibc,
    spec,
    tracerVolumeSize: options.tracerVolumeSize,
    tracerSidecarMemory: options.tracerSidecarMemory,
  }
}

export const selectIngressContainer = (
  containers: readonly IContainer[],
  reservedNames: ReadonlySet<string>
): IContainer => {
  const candidates = containers.filter((container) => !container.name || !reservedNames.has(container.name))
  if (candidates.length === 0) {
    throw new SsiValidationError('No application container was found to instrument.')
  }

  const withPorts = candidates.filter((container) => (container.ports ?? []).length > 0)
  if (withPorts.length === 1) {
    return withPorts[0]
  }
  if (withPorts.length > 1) {
    throw new SsiValidationError(
      `Multiple containers declare ports, so the ingress container is ambiguous: ${withPorts
        .map((container) => container.name || '<unnamed>')
        .join(', ')}. Cloud Run allows exactly one ingress container.`
    )
  }
  if (candidates.length === 1) {
    return candidates[0]
  }

  throw new SsiValidationError(
    `No container declares ports, so the ingress container is ambiguous: ${candidates
      .map((container) => container.name || '<unnamed>')
      .join(', ')}. Declare a container port on your ingress container.`
  )
}
