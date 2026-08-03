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
  const buildSpec = LANGUAGE_SPECS[options.language]
  if (!buildSpec) {
    throw new Error(`Unsupported language: ${String(options.language)}`)
  }
  if (!LIBCS.includes(options.libc)) {
    throw new Error(`Unsupported libc: ${String(options.libc)}`)
  }
  if (options.language === 'ruby' && options.libc === 'musl') {
    throw new Error('Ruby Single-Language SSI does not support musl')
  }

  const root = normalizeRoot(options.root ?? DEFAULT_TRACER_ROOT)
  const image = buildSingleLanguageTracerImage(options.registry, options.language, options.version)
  assertDotnetLayout(options.language, options.version)

  return {image, ...buildSpec(root, options.libc)}
}

type SpecFactory = (root: string, libc: Libc) => Pick<LanguageInjectionSpec, 'artifacts' | 'env'>

const LANGUAGE_SPECS = {
  java: (root) => ({
    artifacts: [[inRoot(root, 'dd-java-agent.jar')]],
    env: [
      {
        name: 'JAVA_TOOL_OPTIONS',
        value: `-javaagent:${inRoot(root, 'dd-java-agent.jar')} -XX:+IgnoreUnrecognizedVMOptions`,
        separator: ' ',
        mode: 'append',
      },
    ],
  }),
  nodejs: (root) => ({
    artifacts: [[inRoot(root, 'node_modules/dd-trace/init.js')]],
    env: [
      {
        name: 'NODE_OPTIONS',
        value: `--require ${inRoot(root, 'node_modules/dd-trace/init.js')}`,
        separator: ' ',
        mode: 'append',
      },
    ],
  }),
  csharp: (root) => ({
    artifacts: [
      [inRoot(root, 'Datadog.Trace.ClrProfiler.Native.so')],
      [inRoot(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so')],
    ],
    env: getDotnetEnv(root),
  }),
  python: (root) => ({
    artifacts: [[inRoot(root, 'sitecustomize.py')]],
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
    artifacts: [[inRoot(root, 'auto_inject.rb')]],
    env: [
      {
        name: 'RUBYOPT',
        value: `-r${inRoot(root, 'auto_inject')}`,
        separator: ' ',
        mode: 'prepend',
      },
    ],
  }),
  php: (root, libc) => {
    const platform = libc === 'glibc' ? 'linux-gnu' : 'linux-musl'
    const loader = inRoot(root, `${platform}/loader`)

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

const normalizeRoot = (root: string): string => {
  if (
    !root.startsWith('/') ||
    /[\s\0]/.test(root) ||
    (root !== '/' && root.includes('//')) ||
    root.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(
      `Tracer root must be an absolute path without whitespace or relative segments: ${JSON.stringify(root)}`
    )
  }

  return root === '/' ? root : root.replace(/\/+$/, '')
}

const inRoot = (root: string, path: string): string => `${root === '/' ? '' : root}/${path}`

const assertDotnetLayout = (language: Language, version: string): void => {
  if (language !== 'csharp') {
    return
  }

  const pinnedMajor = version.match(/^v?(\d+)(?:\.|$)/)?.[1]
  if (pinnedMajor !== undefined && Number(pinnedMajor) < 3) {
    throw new Error(
      `Unsupported .NET tracer version ${JSON.stringify(version)}: versions before 3.0 require architecture-specific package paths`
    )
  }
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
    value: inRoot(root, 'Datadog.Trace.ClrProfiler.Native.so'),
    mode: 'set-if-absent',
  },
  {name: 'DD_DOTNET_TRACER_HOME', value: root, mode: 'set-if-absent'},
  {
    name: 'LD_PRELOAD',
    value: inRoot(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'),
    separator: ' ',
    mode: 'prepend',
    maxLength: 1024,
  },
]
