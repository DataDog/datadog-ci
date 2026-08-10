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
  readonly artifacts: readonly [RequiredArtifact, ...RequiredArtifact[]]
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

  return {image, ...LANGUAGE_CONFIG[options.language].getSpec(root, options.libc)}
}

/** Returns domain compatibility errors after individual CLI arguments have been validated. */
export const getLanguageCompatibilityErrors = (options: LanguageCompatibilityOptions): readonly string[] =>
  LANGUAGE_CONFIG[options.language].getCompatibilityErrors?.(options) ?? []

type LanguageConfig = {
  getSpec: (root: string, libc: Libc) => Pick<LanguageInjectionSpec, 'artifacts' | 'env'>
  getCompatibilityErrors?: (options: Omit<LanguageCompatibilityOptions, 'language'>) => readonly string[]
}

const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
  java: {
    getSpec: (root) => ({
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
  },
  nodejs: {
    getSpec: (root) => ({
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
  },
  csharp: {
    getSpec: (root) => ({
      artifacts: [
        [path.posix.join(root, 'Datadog.Trace.ClrProfiler.Native.so')],
        [path.posix.join(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so')],
      ],
      env: getDotnetEnv(root),
    }),
    getCompatibilityErrors: ({version}) => {
      const pinnedMajor = version.match(/^v?(\d+)(?:\.|$)/)?.[1]

      return pinnedMajor !== undefined && Number(pinnedMajor) < 3
        ? [
            `Automatic instrumentation cannot use .NET tracer version ${JSON.stringify(version)} because versions before 3.0 require architecture-specific package paths. Use tracer version 3.0 or later.`,
          ]
        : []
    },
  },
  python: {
    getSpec: (root) => ({
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
  },
  ruby: {
    getSpec: (root) => ({
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
    getCompatibilityErrors: ({libc}) =>
      libc === 'musl'
        ? ['Ruby automatic instrumentation does not support musl. Use glibc or install the tracer manually.']
        : [],
  },
  php: {
    getSpec: (root, libc) => {
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
  },
}

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
