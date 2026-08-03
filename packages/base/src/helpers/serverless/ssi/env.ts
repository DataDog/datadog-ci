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

export type EnvFragment = PositionedEnvFragment | ScalarEnvFragment

export const hasEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): boolean => {
  if (currentValue === undefined) {
    return false
  }

  return fragment.mode === 'set-if-absent'
    ? currentValue === fragment.value
    : findRanges(currentValue, fragment).length > 0
}

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
  let result: string
  if (!remaining) {
    result = `${fragment.preserveLeadingEmpty ? fragment.separator : ''}${fragment.value}`
  } else if (fragment.mode === 'append') {
    result = `${remaining}${fragment.separator ?? ''}${fragment.value}`
  } else {
    result = `${fragment.value}${fragment.separator ?? ''}${remaining}`
  }
  assertWithinMaxLength(result, fragment)

  return result
}

/**
 * Removes only the exact fragment. Callers must track whether it existed before merging and remove only fragments
 * they own.
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

const findRanges = (currentValue: string, fragment: PositionedEnvFragment): [number, number][] => {
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

  const ranges: [number, number][] = []
  let start = 0
  while (start <= currentValue.length - fragment.value.length) {
    const index = currentValue.indexOf(fragment.value, start)
    if (index === -1) {
      break
    }
    const end = index + fragment.value.length
    const startsAtBoundary = index === 0 || currentValue[index - 1] === separator
    const endsAtBoundary = end === currentValue.length || currentValue[end] === separator
    if (startsAtBoundary && endsAtBoundary) {
      ranges.push([index, end])
    }
    start = end
  }

  return ranges
}

const removeExactFragment = (currentValue: string, fragment: PositionedEnvFragment): string => {
  const ranges = findRanges(currentValue, fragment).map(([start, end]): [number, number] => {
    if (fragment.separator === undefined) {
      return [start, end]
    }
    if (fragment.mode === 'append') {
      if (start > 0 && currentValue[start - 1] === fragment.separator) {
        return [start - 1, end]
      }
      if (end < currentValue.length && currentValue[end] === fragment.separator) {
        return [start, end + 1]
      }
    } else {
      if (end < currentValue.length && currentValue[end] === fragment.separator) {
        return [start, end + 1]
      }
      if (start > 0 && currentValue[start - 1] === fragment.separator) {
        return [start - 1, end]
      }
    }

    return [start, end]
  })

  const merged: [number, number][] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1])
    } else {
      merged.push([...range])
    }
  }

  let result = ''
  let offset = 0
  for (const [start, end] of merged) {
    result += currentValue.slice(offset, start)
    offset = end
  }

  return result + currentValue.slice(offset)
}
