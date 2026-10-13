import type {CompositeInjectionSpec} from './composite'
import type {LanguageInjectionSpec, Libc} from './injection-spec'
import type {Language, TracerRegistry} from './tracer'
import type {TracingMode} from './tracing'

import {MULTI_LANGUAGE_SSI_MODE, SINGLE_LANGUAGE_SSI_MODE, TRACER_MOUNT_PATH} from './constants'
import {DEFAULT_TRACER_LIBC, LIBCS, getLanguageCompatibilityErrors, getLanguageInjectionSpec} from './injection-spec'
import {getCompositeSpec} from './recognition'
import {
  DEFAULT_TRACER_VERSION,
  TRACER_IMAGE_TAG_REG_EXP,
  TRACER_INJECTION_LANGUAGES,
  isTracerInjectionLanguage,
} from './tracer'
import {TRACING_MODES} from './tracing'

/** A tracer input the customer has to correct before instrumentation can continue. */
export class SsiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsiConfigError'
  }
}

/** The tracer inputs a command accepts, after config-file resolution. */
export type SsiOptions = {
  tracing?: TracingMode
  language?: string
  tracerVersion?: string
  tracerLibc?: Libc
  containerName?: string
}

export type SsiConfigResult = (
  | {kind: 'errors'; errors: readonly string[]}
  | {kind: 'no-injection'; tracing: Exclude<TracingMode, 'inject'>}
  | {kind: 'single-language'; language: Language; libc: Libc; spec: LanguageInjectionSpec}
  | {kind: 'multi-language'; spec: CompositeInjectionSpec}
) & {warnings: readonly string[]}

export type InjectionConfig = Extract<SsiConfigResult, {kind: 'single-language' | 'multi-language'}>

/** Tracer inputs a command has accepted, which a transform can apply without checking them again. */
export type ResolvedSsiConfig = Exclude<SsiConfigResult, {kind: 'errors'}>

export const isInjection = (config: SsiConfigResult): config is InjectionConfig =>
  config.kind === 'single-language' || config.kind === 'multi-language'

export const getInjectionMountPath = (config: InjectionConfig): string =>
  config.kind === 'single-language' ? TRACER_MOUNT_PATH : config.spec.mountPath

/** The resource tag or label value recording which injection mode instrumentation wrote. */
export const getInjectionModeTagValue = (config: SsiConfigResult): string | undefined => {
  switch (config.kind) {
    case 'single-language':
      return SINGLE_LANGUAGE_SSI_MODE
    case 'multi-language':
      return MULTI_LANGUAGE_SSI_MODE
    default:
      return undefined
  }
}

export type InjectionPlatform = {
  readonly registry: TracerRegistry
  /** Extra `--language` spellings this command accepts, mapped to the tracer they select. */
  readonly languageAliases?: Readonly<Record<string, Language>>
}

/** Options that describe one language's tracer, so they need both `--tracing inject` and `--language`. */
const SINGLE_LANGUAGE_FLAGS = [
  ['tracerVersion', '--tracer-version'],
  ['tracerLibc', '--tracer-libc'],
] as const satisfies readonly (readonly [keyof SsiOptions, string])[]

/**
 * Resolves tracer inputs into one desired state, before any remote work.
 *
 * Omission resolves to `manual` rather than to the resource's current state, so running a command
 * twice with the same inputs leaves the same instrumentation behind.
 */
export const resolveInjectionConfig = (config: SsiOptions, platform: InjectionPlatform): SsiConfigResult => {
  const inputErrors = validateSsiInputs(config)
  if (inputErrors.length > 0) {
    return toErrors(inputErrors)
  }

  const tracing = config.tracing ?? 'manual'
  if (tracing !== 'inject') {
    const unusedFlags = presentFlags(config, SINGLE_LANGUAGE_FLAGS)
    if (unusedFlags.length > 0) {
      return toErrors([
        `Tracer options ${unusedFlags.join(
          ', '
        )} require --tracing inject. Remove these options or use --tracing inject.`,
      ])
    }

    return {
      kind: 'no-injection',
      tracing,
      // Accepted and ignored rather than rejected: this option predates --tracing inject on some
      // commands, and refusing it would break configuration files that already carry it.
      warnings:
        config.containerName === undefined
          ? []
          : ['Ignoring --container-name, which only selects a container when --tracing inject adds a tracer.'],
    }
  }

  if (config.language === undefined) {
    const unsupportedFlags = presentFlags(config, SINGLE_LANGUAGE_FLAGS)
    if (unsupportedFlags.length > 0) {
      return toErrors([
        `${unsupportedFlags.join(', ')} ${
          unsupportedFlags.length === 1 ? 'requires' : 'require'
        } --language because automatic language detection cannot apply per-language tracer settings. Add --language or remove these options.`,
      ])
    }

    return {kind: 'multi-language', spec: getCompositeSpec(platform.registry), warnings: []}
  }
  if (config.language === 'go') {
    return toErrors([
      'Go automatic instrumentation is not supported. Install dd-trace-go in the application image and use --tracing manual.',
    ])
  }

  const aliases = platform.languageAliases ?? {}
  const language = isTracerInjectionLanguage(config.language) ? config.language : aliases[config.language]
  if (language === undefined) {
    return toErrors([
      `--tracing inject supports only these languages: ${TRACER_INJECTION_LANGUAGES.join(', ')}.${Object.entries(
        aliases
      )
        .map(([alias, target]) => ` \`${alias}\` is accepted as an alias for \`${target}\`.`)
        .join('')}`,
    ])
  }

  const version = config.tracerVersion ?? DEFAULT_TRACER_VERSION
  const libc = config.tracerLibc ?? DEFAULT_TRACER_LIBC
  const compatibilityErrors = getLanguageCompatibilityErrors({language, libc, version})
  if (compatibilityErrors.length > 0) {
    return toErrors(compatibilityErrors)
  }

  return {
    kind: 'single-language',
    language,
    libc,
    spec: getLanguageInjectionSpec({
      language,
      registry: platform.registry,
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

export type ContainerSelection = {
  /** Names instrumentation manages, which are never application candidates. */
  readonly reservedNames: ReadonlySet<string>
  /** What to suggest when the resource declares no application container at all. */
  readonly noCandidatesHint: string
}

/**
 * Selects the one application container to instrument, by stable index.
 *
 * List order never decides: a resource with several candidates and no `--container-name` is
 * rejected rather than instrumented at a guess. Unnamed containers stay candidates because some
 * platforms let customers leave the name off.
 */
export const selectApplicationContainer = <T extends {name?: string}>(
  containers: readonly T[],
  requestedName: string | undefined,
  {reservedNames, noCandidatesHint}: ContainerSelection
): number => {
  const candidates = containers
    .map((container, index) => ({container, index}))
    .filter(({container}) => container.name === undefined || !reservedNames.has(container.name))
  const containerName = requestedName?.trim() || undefined

  if (containerName !== undefined) {
    if (reservedNames.has(containerName)) {
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
      `Cannot enable automatic instrumentation because no application container was found. ${noCandidatesHint}`
    )
  }

  throw new SsiConfigError(
    `Cannot select an application container because there are multiple candidates: ${formatContainerNames(
      candidates
    )}. Specify one with --container-name.`
  )
}

const toErrors = (errors: readonly string[]): SsiConfigResult => ({kind: 'errors', errors, warnings: []})

const presentFlags = (config: SsiOptions, flags: readonly (readonly [keyof SsiOptions, string])[]): string[] =>
  flags.filter(([option]) => config[option] !== undefined).map(([, flag]) => flag)

const formatContainerNames = (candidates: readonly {container: {name?: string}}[]): string =>
  candidates.map(({container}) => container.name || '<unnamed>').join(', ')

/** Rejects values a configuration file can hold that the CLI validators never see. */
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
  if (config.containerName !== undefined && typeof config.containerName !== 'string') {
    errors.push(`Invalid application container name ${JSON.stringify(config.containerName)}.`)
  }

  return errors
}
