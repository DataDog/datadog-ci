import type {AasCodeRuntime} from './ssi'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeInjectionModeTag,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  getLanguageInjectionSpec,
  LANGUAGE_INJECTION_ENV_NAMES,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

export const AAS_SSI_STAGING_ROOT = '/home/data/datadog-tracer'
export const AAS_SSI_TAG = 'dd_sls_injection_mode'
export const AAS_SSI_TAG_VALUE = 'single_language'

const stagingPrefix = `${AAS_SSI_STAGING_ROOT}/`
const LEGACY_AAS_DOTNET_TRACER_HOME = '/home/site/wwwroot/datadog'
const LEGACY_AAS_DOTNET_PROFILER_PATHS = new Set([
  `${LEGACY_AAS_DOTNET_TRACER_HOME}/linux-x64/Datadog.Trace.ClrProfiler.Native.so`,
  `${LEGACY_AAS_DOTNET_TRACER_HOME}/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so`,
])

export const hasStagedAasTracer = (settings: Record<string, string>): boolean =>
  LANGUAGE_INJECTION_ENV_NAMES.some((name) => settings[name]?.includes(stagingPrefix) ?? false)

// The digest's 'sha256:' prefix is stripped: colon-delimited settings (PYTHONPATH, PHP_INI_SCAN_DIR)
// would otherwise split the staged path into two garbage entries.
export const getStagedRoot = (runtime: AasCodeRuntime, version: string, digest: string): string =>
  `${AAS_SSI_STAGING_ROOT}/${runtime.language}/${version}-${digest.replace(/^sha256:/, '')}`

export const mergeAasSsiEnv = (
  current: Record<string, string>,
  runtime: AasCodeRuntime,
  root: string
): Record<string, string> => {
  const spec = getLanguageInjectionSpec({
    language: runtime.language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc: runtime.libc,
    root,
  })
  const env = removeLegacyAasDotnetEnv(removeAasSsiEnv(current))

  for (const fragment of spec.env) {
    env[fragment.name] = mergeEnvFragment(env[fragment.name], fragment)
  }
  env.DD_TAGS = mergeInjectionModeTag(env.DD_TAGS)
  env.DD_TRACE_ENABLED = 'true'

  return env
}

export const removeAasSsiEnv = (current: Record<string, string>): Record<string, string> => {
  const env = {...current}
  for (const [name, value] of Object.entries(env)) {
    const cleaned = removeManagedValue(name, value)
    if (cleaned === undefined) {
      delete env[name]
    } else {
      env[name] = cleaned
    }
  }
  // Once the staged profiler path is gone, leaving the CLR profiling flags set crashes the app on
  // startup, so remove them when they still hold the spec-injected values.
  if (hasStagedAasTracer(current)) {
    if (env.CORECLR_ENABLE_PROFILING === '1') {
      delete env.CORECLR_ENABLE_PROFILING
    }
    if (env.CORECLR_PROFILER === '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}') {
      delete env.CORECLR_PROFILER
    }
  }
  const tags = removeInjectionModeTag(env.DD_TAGS)
  if (tags === undefined) {
    delete env.DD_TAGS
  } else {
    env.DD_TAGS = tags
  }

  return env
}

const removeLegacyAasDotnetEnv = (current: Record<string, string>): Record<string, string> => {
  const env = {...current}
  if (env.DD_DOTNET_TRACER_HOME === LEGACY_AAS_DOTNET_TRACER_HOME) {
    delete env.DD_DOTNET_TRACER_HOME
  }
  if (env.CORECLR_PROFILER_PATH && LEGACY_AAS_DOTNET_PROFILER_PATHS.has(env.CORECLR_PROFILER_PATH)) {
    delete env.CORECLR_PROFILER_PATH
  }

  return env
}

const removeManagedValue = (name: string, value: string): string | undefined => {
  if (name === 'DD_LOADER_PACKAGE_PATH' && value.startsWith(stagingPrefix)) {
    return undefined
  }
  if (name === 'JAVA_TOOL_OPTIONS' && value.includes(`-javaagent:${stagingPrefix}`)) {
    return removeSpaceFragments(
      value,
      (part) => part.startsWith(`-javaagent:${stagingPrefix}`) || part === '-XX:+IgnoreUnrecognizedVMOptions'
    )
  }
  if (name === 'NODE_OPTIONS') {
    return (
      value.replace(new RegExp(`(?:^| )--require ${escapeRegExp(stagingPrefix)}[^ ]+`, 'g'), '').trim() || undefined
    )
  }
  if (name === 'RUBYOPT') {
    return removeSpaceFragments(value, (part) => part.startsWith(`-r${stagingPrefix}`))
  }
  if (name === 'PYTHONPATH' || name === 'PHP_INI_SCAN_DIR') {
    const preserveLeading = name === 'PHP_INI_SCAN_DIR' && value.startsWith(':')
    const parts = value.split(':').filter((part) => !part.startsWith(stagingPrefix))
    const result = parts.join(':')

    return result
      ? `${preserveLeading && !result.startsWith(':') ? ':' : ''}${result}`
      : preserveLeading
        ? ':'
        : undefined
  }
  if (name === 'CORECLR_PROFILER_PATH' || name === 'DD_DOTNET_TRACER_HOME' || name === 'LD_PRELOAD') {
    return removeSpaceFragments(value, (part) => part.startsWith(stagingPrefix))
  }

  return value
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const removeSpaceFragments = (value: string, remove: (part: string) => boolean): string | undefined => {
  const result = value
    .split(' ')
    .filter((part) => !remove(part))
    .join(' ')
    .trim()

  return result || undefined
}

export const getAasSsiSpecEnv = (runtime: AasCodeRuntime, root: string): readonly EnvFragment[] =>
  getLanguageInjectionSpec({
    language: runtime.language,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
    libc: runtime.libc,
    root,
  }).env
