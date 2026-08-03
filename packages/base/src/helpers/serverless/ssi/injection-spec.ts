import path from 'node:path'

import type {EnvFragment} from './env'

import {buildSingleLanguageTracerImage, type Language, type SingleLanguageTracerRegistry} from './tracer'

export const DEFAULT_TRACER_ROOT = '/datadog-lib'
export const LIBCS = ['glibc', 'musl'] as const

export type Libc = (typeof LIBCS)[number]

/** Alternative paths for one required artifact; at least one must exist. */
export type RequiredArtifact = readonly [string, ...string[]]

export interface LanguageInjectionSpec {
  readonly image: string
  readonly artifacts: readonly RequiredArtifact[]
  readonly env: readonly EnvFragment[]
}

export interface LanguageInjectionOptions {
  readonly language: Language
  readonly registry: SingleLanguageTracerRegistry
  readonly version: string
  readonly libc: Libc
  readonly root?: string
}

export type LanguageCompatibilityOptions = Pick<LanguageInjectionOptions, 'language' | 'libc' | 'version'>

/**
 * Builds the image, required artifacts, and environment for one tracer.
 *
 * @example
 * getLanguageInjectionSpec({
 *   language: 'nodejs',
 *   registry: 'gcr.io/datadoghq',
 *   version: 'latest',
 *   libc: 'glibc',
 * })
 */
export const getLanguageInjectionSpec = (options: LanguageInjectionOptions): LanguageInjectionSpec => {
  const root = options.root ?? DEFAULT_TRACER_ROOT
  const image = buildSingleLanguageTracerImage(options.registry, options.language, options.version)

  return {image, ...LANGUAGE_SPECS[options.language](root, options.libc)}
}

/** Returns a domain compatibility error after individual CLI arguments have been validated. */
export const getLanguageCompatibilityError = (options: LanguageCompatibilityOptions): string | undefined => {
  if (options.language === 'ruby' && options.libc === 'musl') {
    return 'Ruby Single-Language SSI does not support musl'
  }
  if (options.language !== 'csharp') {
    return undefined
  }

  const pinnedMajor = options.version.match(/^v?(\d+)(?:\.|$)/)?.[1]

  return pinnedMajor !== undefined && Number(pinnedMajor) < 3
    ? `Unsupported .NET tracer version ${JSON.stringify(options.version)}: versions before 3.0 require architecture-specific package paths`
    : undefined
}

type SpecFactory = (root: string, libc: Libc) => Pick<LanguageInjectionSpec, 'artifacts' | 'env'>

const LANGUAGE_SPECS = {
  java: (root) => ({
    artifacts: [[path.posix.join(root, 'dd-java-agent.jar')]],
    env: [
      {
        name: 'JAVA_TOOL_OPTIONS',
        value: `-javaagent:${path.posix.join(root, 'dd-java-agent.jar')} -XX:+IgnoreUnrecognizedVMOptions`,
        separator: ' ',
        mode: 'append',
      },
    ],
  }),
  nodejs: (root) => ({
    artifacts: [[path.posix.join(root, 'node_modules/dd-trace/init.js')]],
    env: [
      {
        name: 'NODE_OPTIONS',
        value: `--require ${path.posix.join(root, 'node_modules/dd-trace/init.js')}`,
        separator: ' ',
        mode: 'append',
      },
    ],
  }),
  csharp: (root) => ({
    artifacts: [
      [path.posix.join(root, 'Datadog.Trace.ClrProfiler.Native.so')],
      [path.posix.join(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so')],
    ],
    env: getDotnetEnv(root),
  }),
  python: (root) => ({
    artifacts: [[path.posix.join(root, 'sitecustomize.py')]],
    env: [
      {
        name: 'PYTHONPATH',
        value: root,
        separator: ':',
        mode: 'append',
      },
    ],
  }),
  ruby: (root) => ({
    artifacts: [[path.posix.join(root, 'auto_inject.rb')]],
    env: [
      {
        name: 'RUBYOPT',
        value: `-r${path.posix.join(root, 'auto_inject')}`,
        separator: ' ',
        mode: 'prepend',
      },
    ],
  }),
  php: (root, libc) => {
    const platform = libc === 'glibc' ? 'linux-gnu' : 'linux-musl'
    const loader = path.posix.join(root, `${platform}/loader`)

    return {
      artifacts: [[`${loader}/dd_library_loader.ini`], [`${loader}/dd_library_loader.so`]],
      env: [
        {
          name: 'PHP_INI_SCAN_DIR',
          value: loader,
          separator: ':',
          mode: 'append',
          preserveLeadingEmpty: true,
        },
        {name: 'DD_LOADER_PACKAGE_PATH', value: root, mode: 'set-if-absent'},
      ],
    }
  },
} satisfies Record<Language, SpecFactory>

const getDotnetEnv = (root: string): EnvFragment[] => [
  {name: 'CORECLR_ENABLE_PROFILING', value: '1', mode: 'set-if-absent'},
  {
    name: 'CORECLR_PROFILER',
    value: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
    mode: 'set-if-absent',
  },
  {
    name: 'CORECLR_PROFILER_PATH',
    value: path.posix.join(root, 'Datadog.Trace.ClrProfiler.Native.so'),
    mode: 'set-if-absent',
  },
  {name: 'DD_DOTNET_TRACER_HOME', value: root, mode: 'set-if-absent'},
  {
    name: 'LD_PRELOAD',
    value: path.posix.join(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'),
    separator: ' ',
    mode: 'prepend',
    maxLength: 1024,
  },
]
