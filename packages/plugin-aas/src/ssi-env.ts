import type {AasCodeRuntime} from './ssi'
import type {EnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {
  mergeEnvFragment,
  mergeInjectionModeTag,
  removeInjectionModeTag,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {getLanguageInjectionSpec} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

export const AAS_SSI_STAGING_ROOT = '/home/data/datadog-tracer'
export const AAS_SSI_TAG = 'dd_sls_injection_mode'
export const AAS_SSI_TAG_VALUE = 'single_language'

const stagingPrefix = `${AAS_SSI_STAGING_ROOT}/`
const dotnetScalars = new Set(['CORECLR_ENABLE_PROFILING', 'CORECLR_PROFILER'])

export const getStagedRoot = (runtime: AasCodeRuntime, version: string, digest: string): string =>
  `${AAS_SSI_STAGING_ROOT}/${runtime.language}/${version}-${digest}`

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
  const env = removeAasSsiEnv(current)

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
  const tags = removeInjectionModeTag(env.DD_TAGS)
  if (tags === undefined) {
    delete env.DD_TAGS
  } else {
    env.DD_TAGS = tags
  }

  return env
}

const removeManagedValue = (name: string, value: string): string | undefined => {
  if (dotnetScalars.has(name) && (value === '1' || value === '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}')) {
    return undefined
  }
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
