import type {EnvFragment} from './env'

import {
  LANGUAGE_METADATA,
  buildSingleLanguageTracerImage,
  type CanonicalTracerLanguage,
  type ServerlessLanguage,
  type SingleLanguageTracerRegistry,
} from './tracer'

export const DEFAULT_SINGLE_LANGUAGE_TRACER_ROOT = '/datadog-lib'

export type ServerlessLibc = 'glibc' | 'musl'

/** Each entry is a set of alternative paths. At least one path in every entry must exist. */
export type RequiredFileAlternatives = readonly [string, ...string[]]

export interface SingleLanguageInjectionSpec {
  language: ServerlessLanguage
  canonicalLanguage: CanonicalTracerLanguage
  repository: string
  image: string
  requiredFiles: RequiredFileAlternatives[]
  env: EnvFragment[]
}

export interface SingleLanguageInjectionOptions {
  language: ServerlessLanguage
  registry: SingleLanguageTracerRegistry
  version: string
  libc: ServerlessLibc
  root?: string
}

const LIBC_VALUES: readonly ServerlessLibc[] = ['glibc', 'musl']

const validateStringValue = (value: string, description: string): void => {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) {
    throw new Error(`${description} must be a non-empty single-line string`)
  }
}

const normalizeRoot = (root: string): string => {
  validateStringValue(root, 'Tracer root')
  if (
    !root.startsWith('/') ||
    /\s/.test(root) ||
    (root !== '/' && root.includes('//')) ||
    root.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(
      `Tracer root must be an absolute path without whitespace or relative segments: ${JSON.stringify(root)}`
    )
  }

  return root === '/' ? root : root.replace(/\/+$/, '')
}

const pathInRoot = (root: string, path: string): string => `${root === '/' ? '' : root}/${path}`

const getRuntimeVersionAgnosticJavaEnv = (root: string): EnvFragment[] => [
  {
    name: 'JAVA_TOOL_OPTIONS',
    value: `-javaagent:${pathInRoot(root, 'dd-java-agent.jar')} -XX:+IgnoreUnrecognizedVMOptions`,
    separator: ' ',
    direction: 'append',
  },
]

const assertArchitectureNeutralDotnetLayout = (language: ServerlessLanguage, version: string): void => {
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
  {name: 'CORECLR_ENABLE_PROFILING', value: '1', direction: 'set-if-absent'},
  {
    name: 'CORECLR_PROFILER',
    value: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
    direction: 'set-if-absent',
  },
  {
    name: 'CORECLR_PROFILER_PATH',
    value: pathInRoot(root, 'Datadog.Trace.ClrProfiler.Native.so'),
    direction: 'set-if-absent',
  },
  {name: 'DD_DOTNET_TRACER_HOME', value: root, direction: 'set-if-absent'},
  {
    name: 'LD_PRELOAD',
    value: pathInRoot(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'),
    separator: ' ',
    direction: 'prepend',
    maxLength: 1024,
  },
]

const getLanguageFilesAndEnv = (
  language: ServerlessLanguage,
  libc: ServerlessLibc,
  root: string
): Pick<SingleLanguageInjectionSpec, 'requiredFiles' | 'env'> => {
  switch (language) {
    case 'java':
      return {
        requiredFiles: [[pathInRoot(root, 'dd-java-agent.jar')]],
        env: getRuntimeVersionAgnosticJavaEnv(root),
      }
    case 'nodejs':
      return {
        requiredFiles: [[pathInRoot(root, 'node_modules/dd-trace/init.js')]],
        env: [
          {
            name: 'NODE_OPTIONS',
            value: `--require ${pathInRoot(root, 'node_modules/dd-trace/init.js')}`,
            separator: ' ',
            direction: 'append',
          },
        ],
      }
    case 'csharp':
      return {
        requiredFiles: [
          [pathInRoot(root, 'Datadog.Trace.ClrProfiler.Native.so')],
          [pathInRoot(root, 'continuousprofiler/Datadog.Linux.ApiWrapper.x64.so')],
        ],
        env: getDotnetEnv(root),
      }
    case 'python':
      return {
        requiredFiles: [[pathInRoot(root, 'sitecustomize.py')]],
        env: [
          {
            name: 'PYTHONPATH',
            value: root,
            separator: ':',
            direction: 'append',
          },
        ],
      }
    case 'ruby':
      return {
        requiredFiles: [[pathInRoot(root, 'auto_inject.rb')]],
        env: [
          {
            name: 'RUBYOPT',
            value: `-r${pathInRoot(root, 'auto_inject')}`,
            separator: ' ',
            direction: 'prepend',
          },
        ],
      }
    case 'php': {
      const loaderRoot = pathInRoot(root, `linux-${libc === 'glibc' ? 'gnu' : 'musl'}/loader`)

      return {
        requiredFiles: [[`${loaderRoot}/dd_library_loader.ini`], [`${loaderRoot}/dd_library_loader.so`]],
        env: [
          {name: 'PHP_INI_SCAN_DIR', value: `:${loaderRoot}`, direction: 'append'},
          {name: 'DD_LOADER_PACKAGE_PATH', value: root, direction: 'set-if-absent'},
        ],
      }
    }
  }
}

export const getSingleLanguageInjectionSpec = (
  options: SingleLanguageInjectionOptions
): SingleLanguageInjectionSpec => {
  const metadata = LANGUAGE_METADATA[options.language]
  if (!metadata) {
    throw new Error(`Unsupported serverless language: ${String(options.language)}`)
  }
  if (!LIBC_VALUES.includes(options.libc)) {
    throw new Error(`Unsupported libc: ${String(options.libc)}`)
  }
  if (options.language === 'ruby' && options.libc === 'musl') {
    throw new Error('Ruby Single-Language SSI does not support musl')
  }

  const root = normalizeRoot(options.root ?? DEFAULT_SINGLE_LANGUAGE_TRACER_ROOT)
  const image = buildSingleLanguageTracerImage(options.registry, metadata.canonicalLanguage, options.version)
  assertArchitectureNeutralDotnetLayout(options.language, options.version)
  const languageSpec = getLanguageFilesAndEnv(options.language, options.libc, root)

  return {
    language: options.language,
    canonicalLanguage: metadata.canonicalLanguage,
    repository: metadata.repository,
    image,
    ...languageSpec,
  }
}
