export const SINGLE_LANGUAGE_INJECTION_MODE_TAG = '_dd.injection.mode:serverless-single-lang'

type EnvFragmentBase = {
  name: string
  value: string
  maxLength?: number
}

type EnvSeparator = ' ' | ':' | ','

type AppendedEnvFragment = EnvFragmentBase &
  (
    | {mode: 'append'; separator?: EnvSeparator; preserveLeadingEmpty?: never}
    | {mode: 'append'; separator: EnvSeparator; preserveLeadingEmpty: true}
  )

type PositionedEnvFragment =
  | AppendedEnvFragment
  | (EnvFragmentBase & {mode: 'prepend'; separator?: EnvSeparator; preserveLeadingEmpty?: never})

type ScalarEnvFragment = EnvFragmentBase & {
  mode: 'set-if-absent'
  separator?: never
  preserveLeadingEmpty?: never
}

/**
 * An environment value owned by instrumentation. `mode` controls placement, `separator` defines exact entry
 * boundaries, and `maxLength` limits the merged value in bytes. `preserveLeadingEmpty` retains the default entry in
 * path lists such as `PHP_INI_SCAN_DIR`.
 */
export type EnvFragment = PositionedEnvFragment | ScalarEnvFragment

/**
 * Checks whether an environment variable contains the exact owned fragment.
 *
 * @example
 * hasEnvFragment('--inspect --require /datadog-lib/node_modules/dd-trace/init.js', {
 *   name: 'NODE_OPTIONS',
 *   value: '--require /datadog-lib/node_modules/dd-trace/init.js',
 *   separator: ' ',
 *   mode: 'append',
 * }) // true
 */
export const hasEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): boolean => {
  if (currentValue === undefined) {
    return false
  }

  return fragment.mode === 'set-if-absent'
    ? currentValue === fragment.value
    : findRanges(currentValue, fragment).length > 0
}

/**
 * Adds an owned fragment once in its configured position.
 *
 * @example
 * mergeEnvFragment('--inspect', {
 *   name: 'NODE_OPTIONS',
 *   value: '--require /datadog-lib/node_modules/dd-trace/init.js',
 *   separator: ' ',
 *   mode: 'append',
 * }) // '--inspect --require /datadog-lib/node_modules/dd-trace/init.js'
 *
 * @example
 * mergeEnvFragment(undefined, {
 *   name: 'PHP_INI_SCAN_DIR',
 *   value: '/datadog-lib/linux-gnu/loader',
 *   separator: ':',
 *   mode: 'append',
 *   preserveLeadingEmpty: true,
 * }) // ':/datadog-lib/linux-gnu/loader'
 */
export const mergeEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string => {
  if (fragment.mode === 'set-if-absent') {
    if (currentValue && currentValue !== fragment.value) {
      throw new EnvFragmentConflictError(fragment.name, currentValue, fragment.value)
    }
    const value = currentValue || fragment.value
    assertWithinMaxLength(value, fragment)

    return value
  }

  const remaining = currentValue === undefined ? undefined : removeExactFragment(currentValue, fragment)
  const result = mergePositionedFragment(remaining, fragment)
  assertWithinMaxLength(result, fragment)

  return result
}

/**
 * Removes an exact fragment. Only remove fragments owned by the caller.
 *
 * @example
 * removeEnvFragment('--inspect --require /datadog-lib/node_modules/dd-trace/init.js', {
 *   name: 'NODE_OPTIONS',
 *   value: '--require /datadog-lib/node_modules/dd-trace/init.js',
 *   separator: ' ',
 *   mode: 'append',
 * }) // '--inspect'
 */
export const removeEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string | undefined => {
  if (!currentValue) {
    return undefined
  }
  if (fragment.mode === 'set-if-absent') {
    return currentValue === fragment.value ? undefined : currentValue
  }

  return removeExactFragment(currentValue, fragment) || undefined
}

const INJECTION_MODE_TAG_FRAGMENT: EnvFragment = {
  name: 'DD_TAGS',
  value: SINGLE_LANGUAGE_INJECTION_MODE_TAG,
  separator: ',',
  mode: 'prepend',
}

export const hasInjectionModeTag = (currentTags: string | undefined): boolean =>
  hasEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)

export const mergeInjectionModeTag = (currentTags: string | undefined): string =>
  mergeEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)

export const removeInjectionModeTag = (currentTags: string | undefined): string | undefined =>
  removeEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)

export class EnvFragmentConflictError extends Error {
  constructor(name: string, currentValue: string, requiredValue: string) {
    super(`${name} is already set to ${JSON.stringify(currentValue)}; expected ${JSON.stringify(requiredValue)}`)
    this.name = 'EnvFragmentConflictError'
  }
}

const assertWithinMaxLength = (value: string, fragment: EnvFragment): void => {
  if (fragment.maxLength !== undefined && Buffer.byteLength(value) > fragment.maxLength) {
    throw new Error(`${fragment.name} exceeds its ${fragment.maxLength}-byte limit`)
  }
}

const mergePositionedFragment = (currentValue: string | undefined, fragment: PositionedEnvFragment): string => {
  if (!currentValue) {
    return `${fragment.preserveLeadingEmpty ? fragment.separator : ''}${fragment.value}`
  }

  switch (fragment.mode) {
    case 'append':
      return `${currentValue}${fragment.separator ?? ''}${fragment.value}`
    case 'prepend':
      return `${fragment.value}${fragment.separator ?? ''}${currentValue}`
  }
}

type Range = readonly [start: number, end: number]

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const findRanges = (currentValue: string, fragment: PositionedEnvFragment): Range[] => {
  const {separator} = fragment
  if (separator === undefined) {
    if (fragment.mode === 'append' && currentValue.endsWith(fragment.value)) {
      return [[currentValue.length - fragment.value.length, currentValue.length]]
    }
    if (fragment.mode === 'prepend' && currentValue.startsWith(fragment.value)) {
      return [[0, fragment.value.length]]
    }

    return []
  }

  const pattern = new RegExp(`(^|${escapeRegExp(separator)})(${escapeRegExp(fragment.value)})(?=${separator}|$)`, 'g')

  return [...currentValue.matchAll(pattern)].map((match): Range => {
    const start = match.index! + match[1].length

    return [start, start + fragment.value.length]
  })
}

const expandRange = (currentValue: string, fragment: PositionedEnvFragment, [start, end]: Range): Range => {
  const {separator} = fragment
  if (separator === undefined) {
    return [start, end]
  }

  const canRemoveBefore = start > 0 && currentValue[start - 1] === separator
  const canRemoveAfter = end < currentValue.length && currentValue[end] === separator

  if (fragment.mode === 'append') {
    if (canRemoveBefore) {
      return [start - 1, end]
    }
    if (canRemoveAfter) {
      return [start, end + 1]
    }
  } else {
    if (canRemoveAfter) {
      return [start, end + 1]
    }
    if (canRemoveBefore) {
      return [start - 1, end]
    }
  }

  return [start, end]
}

const mergeRanges = (ranges: Range[]): Range[] =>
  ranges.reduce<Range[]>((merged, range) => {
    const previous = merged.at(-1)

    return previous && range[0] <= previous[1]
      ? [...merged.slice(0, -1), [previous[0], Math.max(previous[1], range[1])]]
      : [...merged, range]
  }, [])

const removeExactFragment = (currentValue: string, fragment: PositionedEnvFragment): string => {
  const ranges = mergeRanges(
    findRanges(currentValue, fragment).map((range) => expandRange(currentValue, fragment, range))
  )
  const parts = ranges.map(([start], index) => currentValue.slice(index === 0 ? 0 : ranges[index - 1][1], start))

  return [...parts, currentValue.slice(ranges.at(-1)?.[1] ?? 0)].join('')
}
