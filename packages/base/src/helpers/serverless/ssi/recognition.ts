import type {CompositeInjectionSpec} from './composite'
import type {EnvFragment, EnvFragmentGroup} from './env'
import type {Language, TracerRegistry} from './tracer'

import {getCompositeInjectionSpec} from './composite'
import {TRACER_MOUNT_PATH} from './constants'
import {LIBCS, getLanguageInjectionSpec} from './injection-spec'
import {DEFAULT_TRACER_VERSION, LANGUAGE_METADATA, TRACER_IMAGE_TAG_REG_EXP, TRACER_INJECTION_LANGUAGES} from './tracer'

/** The mount path a managed tracer image copies into, and the environment it activates. */
export interface ManagedTracerConfig {
  readonly mountPath: string
  /** One entry per libc, since the image alone does not say which one was injected. */
  readonly envVariants: readonly (readonly EnvFragment[])[]
}

type RegistryTables = {
  readonly composite: CompositeInjectionSpec
  readonly languageVariants: readonly {language: Language; env: readonly EnvFragment[]}[]
  readonly injectionEnvGroups: readonly EnvFragmentGroup[]
  readonly managedMountPaths: ReadonlySet<string>
}

// Built once per registry: recognition runs on every describe, and each table costs one injection
// spec per language and libc.
const TABLES = new Map<TracerRegistry, RegistryTables>()

const tablesFor = (registry: TracerRegistry): RegistryTables => {
  const cached = TABLES.get(registry)
  if (cached) {
    return cached
  }

  const composite = getCompositeInjectionSpec(registry)
  const languageVariants = TRACER_INJECTION_LANGUAGES.flatMap((language) =>
    LIBCS.map((libc) => ({
      language,
      env: getLanguageInjectionSpec({
        language,
        libc,
        registry,
        version: DEFAULT_TRACER_VERSION,
        root: TRACER_MOUNT_PATH,
      }).env,
    }))
  )
  const tables: RegistryTables = {
    composite,
    languageVariants,
    injectionEnvGroups: [
      ...languageVariants.map(({env}) => toEnvFragmentGroup(env, TRACER_MOUNT_PATH)),
      toEnvFragmentGroup(composite.env, composite.mountPath),
    ],
    managedMountPaths: new Set([TRACER_MOUNT_PATH, composite.mountPath]),
  }
  TABLES.set(registry, tables)

  return tables
}

const toEnvFragmentGroup = (env: readonly EnvFragment[], root: string): EnvFragmentGroup => ({
  identifying: env.filter((fragment) => fragment.value.includes(root)),
  shared: env.filter((fragment) => !fragment.value.includes(root)),
})

export const getCompositeSpec = (registry: TracerRegistry): CompositeInjectionSpec => tablesFor(registry).composite

/** Every environment fragment any injection mode could have written, grouped for safe removal. */
export const getInjectionEnvGroups = (registry: TracerRegistry): readonly EnvFragmentGroup[] =>
  tablesFor(registry).injectionEnvGroups

/** The mount paths instrumentation owns, whichever injection mode wrote them. */
export const getManagedTracerMountPaths = (registry: TracerRegistry): ReadonlySet<string> =>
  tablesFor(registry).managedMountPaths

/**
 * Recognizes a Datadog tracer image and returns what it would have configured, or `undefined` when
 * the image is not one instrumentation copies from.
 */
export const getManagedTracerConfig = (
  image: string | undefined,
  registry: TracerRegistry
): ManagedTracerConfig | undefined => {
  const {composite, languageVariants} = tablesFor(registry)
  if (image === composite.image) {
    return {mountPath: composite.mountPath, envVariants: [composite.env]}
  }

  const language = getTracerImageLanguage(image, registry)

  return language === undefined
    ? undefined
    : {
        mountPath: TRACER_MOUNT_PATH,
        envVariants: languageVariants.filter((variant) => variant.language === language).map(({env}) => env),
      }
}

/** The tracer artifacts a resource declares, which the caller reads out of its own shape. */
export type TracerArtifacts = {
  /** What each tracer container whose image and shape instrumentation recognizes would configure. */
  readonly tracers: readonly ManagedTracerConfig[]
  /** How many volumes carry the managed tracer name. */
  readonly volumeCount: number
  /** Tracer-volume mounts declared by containers other than the tracer itself, by container index. */
  readonly mounts: readonly {index: number; path: string}[]
}

/**
 * The tracer injected into one container, or `undefined` when the artifacts do not form the single
 * coherent set instrumentation writes.
 *
 * Several tracer containers, several tracer volumes, or a mount on a container other than the
 * target all mean the resource is not in a state this command produced, so the caller rebuilds it
 * rather than reporting it as already instrumented.
 */
export const getInjectedTracer = (
  {tracers, volumeCount, mounts}: TracerArtifacts,
  targetIndex: number
): ManagedTracerConfig | undefined =>
  tracers.length === 1 &&
  volumeCount === 1 &&
  mounts.length === 1 &&
  mounts[0].index === targetIndex &&
  mounts[0].path === tracers[0].mountPath
    ? tracers[0]
    : undefined

const getTracerImageLanguage = (image: string | undefined, registry: TracerRegistry): Language | undefined =>
  TRACER_INJECTION_LANGUAGES.find((language) => {
    const prefix = `${registry}/dd-lib-${LANGUAGE_METADATA[language].tracerLanguage}-init:`
    const version = image?.startsWith(prefix) ? image.slice(prefix.length) : undefined

    return version !== undefined && TRACER_IMAGE_TAG_REG_EXP.test(version)
  })
