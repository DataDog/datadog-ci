import type {EnvFragment, EnvFragmentGroup} from './env'

import {DD_TAGS_ENV_VAR} from '../constants'

import {SsiConfigError} from './config'
import {hasEnvFragment, mergeEnvFragment, removeEnvFragment, removeInjectionModeTag} from './env'

/**
 * Reads and writes one platform's container environment entries.
 *
 * Built per container, because whether a name resolves from a secret is a property of the
 * container rather than of the entry on platforms that keep secrets in a separate field.
 */
export interface EnvOps<T> {
  /** Whether a declared entry carries `name`, applying the platform's name casing. */
  matches: (variable: T, name: string) => boolean
  /** The literal value, or `undefined` when the entry does not have one. */
  valueOf: (variable: T) => string | undefined
  /** Whether the container resolves `name` from a secret rather than a literal. */
  isSecretBacked: (name: string) => boolean
  create: (name: string, value: string) => T
  withValue: (variable: T, value: string) => T
}

export const findEnv = <T>(env: readonly T[], name: string, ops: EnvOps<T>): T | undefined =>
  env.find((variable) => ops.matches(variable, name))

export const upsertEnv = <T>(env: readonly T[], name: string, value: string, ops: EnvOps<T>): T[] => {
  const index = env.findIndex((variable) => ops.matches(variable, name))
  if (index === -1) {
    return [...env, ops.create(name, value)]
  }

  const updated = env.slice()
  updated[index] = ops.withValue(env[index], value)

  return updated
}

/**
 * Rejects an environment instrumentation cannot merge into safely.
 *
 * A duplicate or secret-backed name has no single literal value to append to, so merging would
 * either drop the customer's value or write a fragment the container never reads.
 */
export const assertFragmentsCanBeMerged = <T>(
  env: readonly T[],
  fragments: readonly EnvFragment[],
  extraNames: readonly string[],
  ops: EnvOps<T>
): void => {
  for (const name of new Set([...fragments.map((fragment) => fragment.name), ...extraNames])) {
    if (env.filter((variable) => ops.matches(variable, name)).length > 1) {
      throw new SsiConfigError(
        `${name} appears more than once on the selected application container. Remove the duplicate before retrying.`
      )
    }
    if (ops.isSecretBacked(name)) {
      throw new SsiConfigError(
        `${name} on the selected application container comes from a secret reference. Set it to a literal value or remove it before retrying.`
      )
    }
  }
}

/** Adds each owned fragment once, preserving whatever the customer already set. */
export const mergeFragments = <T>(
  env: readonly T[],
  fragments: readonly EnvFragment[],
  extraNames: readonly string[],
  ops: EnvOps<T>
): T[] => {
  assertFragmentsCanBeMerged(env, fragments, extraNames, ops)

  return fragments.reduce<T[]>(
    (current, fragment) => {
      const value = valueOfName(current, fragment.name, ops)

      return upsertEnv(current, fragment.name, mergeFragmentValue(value, fragment), ops)
    },
    [...env]
  )
}

/**
 * Removes the tracer startup environment, keeping the settings a manual tracer install shares with
 * instrumentation unless the same variant also left one only instrumentation could have written.
 *
 * Without that pairing, removal would break the manual tracing it is supposed to leave alone: a
 * .NET image carrying its own tracer sets the same `CORECLR_ENABLE_PROFILING` and `CORECLR_PROFILER`
 * values instrumentation does, and dropping them stops the profiler from loading.
 */
export const removeFragmentGroups = <T>(env: readonly T[], groups: readonly EnvFragmentGroup[], ops: EnvOps<T>): T[] =>
  removeFragments(
    env,
    groups.flatMap(({identifying, shared}) =>
      identifying.some((fragment) => hasEnvFragment(valueOfName(env, fragment.name, ops), fragment))
        ? [...identifying, ...shared]
        : identifying
    ),
    ops
  )

/**
 * Removes the exact fragments instrumentation owns, along with the single-language injection mode
 * tag, and drops entries left empty.
 */
export const removeFragments = <T>(env: readonly T[], fragments: readonly EnvFragment[], ops: EnvOps<T>): T[] =>
  env.flatMap((variable) => {
    const value = ops.valueOf(variable)
    if (value === undefined) {
      return [variable]
    }

    const owned = fragments.filter((fragment) => ops.matches(variable, fragment.name))
    const withoutTag = ops.matches(variable, DD_TAGS_ENV_VAR) ? removeInjectionModeTag(value) : value
    const remaining = owned.reduce<string | undefined>(removeEnvFragment, withoutTag)

    return remaining === undefined ? [] : [remaining === value ? variable : ops.withValue(variable, remaining)]
  })

/** Whether every fragment of one variant is already present, used to recognize existing injection. */
export const hasAllFragments = <T>(env: readonly T[], fragments: readonly EnvFragment[], ops: EnvOps<T>): boolean =>
  fragments.every((fragment) => hasEnvFragment(valueOfName(env, fragment.name, ops), fragment))

const valueOfName = <T>(env: readonly T[], name: string, ops: EnvOps<T>): string | undefined => {
  const existing = findEnv(env, name, ops)

  return existing === undefined ? undefined : ops.valueOf(existing)
}

const mergeFragmentValue = (currentValue: string | undefined, fragment: EnvFragment): string => {
  try {
    return mergeEnvFragment(currentValue, fragment)
  } catch (error) {
    throw new SsiConfigError(
      `Cannot enable automatic instrumentation while updating ${fragment.name}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
