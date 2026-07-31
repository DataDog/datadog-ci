export const SINGLE_LANGUAGE_INJECTION_MODE_TAG = '_dd.injection.mode:serverless-single-lang'

export type EnvMergeDirection = 'append' | 'prepend' | 'set-if-absent'
export type EnvSeparator = ' ' | ':' | ','

export interface EnvFragment {
  name: string
  value: string
  separator?: EnvSeparator
  direction: EnvMergeDirection
  maxLength?: number
}

export class EnvFragmentConflictError extends Error {
  constructor(name: string, currentValue: string, requiredValue: string) {
    super(`${name} is already set to ${JSON.stringify(currentValue)}; expected ${JSON.stringify(requiredValue)}`)
    this.name = 'EnvFragmentConflictError'
  }
}

const ENV_NAME_REG_EXP = /^[A-Za-z_][A-Za-z0-9_]*$/

const validateStringValue = (value: string, description: string): void => {
  if (typeof value !== 'string' || !value || /[\0\r\n]/.test(value)) {
    throw new Error(`${description} must be a non-empty single-line string`)
  }
}

const validateCurrentValue = (value: string | undefined, name: string): void => {
  if (value !== undefined && (typeof value !== 'string' || /[\0\r\n]/.test(value))) {
    throw new Error(`Existing value for ${name} must be a single-line string`)
  }
}

const validateFragment = (fragment: EnvFragment): void => {
  if (!ENV_NAME_REG_EXP.test(fragment.name)) {
    throw new Error(`Invalid environment variable name: ${JSON.stringify(fragment.name)}`)
  }
  validateStringValue(fragment.value, `Fragment for ${fragment.name}`)
  if (fragment.direction === 'set-if-absent' && fragment.separator !== undefined) {
    throw new Error(`set-if-absent fragment ${fragment.name} cannot have a separator`)
  }
  if (fragment.maxLength !== undefined && (!Number.isInteger(fragment.maxLength) || fragment.maxLength <= 0)) {
    throw new Error(`maxLength for ${fragment.name} must be a positive integer`)
  }
}

const assertWithinMaxLength = (value: string, fragment: EnvFragment): void => {
  if (fragment.maxLength !== undefined && Buffer.byteLength(value) > fragment.maxLength) {
    throw new Error(`${fragment.name} exceeds its ${fragment.maxLength}-byte limit`)
  }
}

const findExactFragmentRanges = (currentValue: string, fragment: EnvFragment): [number, number][] => {
  const separator = fragment.separator
  if (separator === undefined) {
    if (fragment.direction === 'append' && fragment.value.startsWith(':')) {
      const colonDelimitedRanges: [number, number][] = []
      let searchOffset = 0
      while (searchOffset <= currentValue.length - fragment.value.length) {
        const index = currentValue.indexOf(fragment.value, searchOffset)
        if (index === -1) {
          break
        }
        const end = index + fragment.value.length
        if (end === currentValue.length || currentValue[end] === ':') {
          colonDelimitedRanges.push([index, end])
        }
        searchOffset = end
      }

      return colonDelimitedRanges
    }
    if (fragment.direction === 'append' && currentValue.endsWith(fragment.value)) {
      return [[currentValue.length - fragment.value.length, currentValue.length]]
    }
    if (fragment.direction === 'prepend' && currentValue.startsWith(fragment.value)) {
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
    const hasStartBoundary = index === 0 || currentValue[index - 1] === separator
    const hasEndBoundary = end === currentValue.length || currentValue[end] === separator
    if (hasStartBoundary && hasEndBoundary) {
      ranges.push([index, end])
    }
    start = end
  }

  return ranges
}

const removeRanges = (currentValue: string, fragment: EnvFragment, ranges: [number, number][]): string => {
  const separator = fragment.separator
  const expandedRanges = ranges.map(([start, end]): [number, number] => {
    if (separator === undefined) {
      return [start, end]
    }
    if (fragment.direction === 'append') {
      if (start > 0 && currentValue[start - 1] === separator) {
        return [start - 1, end]
      }
      if (end < currentValue.length && currentValue[end] === separator) {
        return [start, end + 1]
      }
    } else if (fragment.direction === 'prepend') {
      if (end < currentValue.length && currentValue[end] === separator) {
        return [start, end + 1]
      }
      if (start > 0 && currentValue[start - 1] === separator) {
        return [start - 1, end]
      }
    }

    return [start, end]
  })

  const mergedRanges: [number, number][] = []
  for (const range of expandedRanges) {
    const previous = mergedRanges.at(-1)
    if (previous && range[0] <= previous[1]) {
      previous[1] = Math.max(previous[1], range[1])
    } else {
      mergedRanges.push([...range])
    }
  }

  let result = ''
  let offset = 0
  for (const [start, end] of mergedRanges) {
    result += currentValue.slice(offset, start)
    offset = end
  }

  return result + currentValue.slice(offset)
}

const removeExactFragments = (currentValue: string, fragment: EnvFragment): string => {
  return removeRanges(currentValue, fragment, findExactFragmentRanges(currentValue, fragment))
}

export const hasEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): boolean => {
  validateFragment(fragment)
  validateCurrentValue(currentValue, fragment.name)
  if (currentValue === undefined) {
    return false
  }

  return fragment.direction === 'set-if-absent'
    ? currentValue === fragment.value
    : findExactFragmentRanges(currentValue, fragment).length > 0
}

export const mergeEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string => {
  validateFragment(fragment)
  validateCurrentValue(currentValue, fragment.name)

  if (fragment.direction === 'set-if-absent') {
    if (currentValue && currentValue !== fragment.value) {
      throw new EnvFragmentConflictError(fragment.name, currentValue, fragment.value)
    }
    const scalarValue = currentValue || fragment.value
    assertWithinMaxLength(scalarValue, fragment)

    return scalarValue
  }

  const valueWithoutFragment = currentValue === undefined ? undefined : removeExactFragments(currentValue, fragment)
  let result: string
  if (!valueWithoutFragment) {
    result = fragment.value
  } else if (fragment.direction === 'append') {
    result = `${valueWithoutFragment}${fragment.separator ?? ''}${fragment.value}`
  } else {
    result = `${fragment.value}${fragment.separator ?? ''}${valueWithoutFragment}`
  }
  assertWithinMaxLength(result, fragment)

  return result
}

/**
 * Removes exact values described by the fragment only. Callers must track whether a matching value pre-existed
 * before merging and call this helper only for values they own.
 */
export const removeEnvFragment = (currentValue: string | undefined, fragment: EnvFragment): string | undefined => {
  validateFragment(fragment)
  validateCurrentValue(currentValue, fragment.name)
  if (!currentValue) {
    return undefined
  }
  if (fragment.direction === 'set-if-absent') {
    return currentValue === fragment.value ? undefined : currentValue
  }

  return removeExactFragments(currentValue, fragment) || undefined
}

const INJECTION_MODE_TAG_FRAGMENT: EnvFragment = {
  name: 'DD_TAGS',
  value: SINGLE_LANGUAGE_INJECTION_MODE_TAG,
  separator: ',',
  direction: 'prepend',
}

export const hasInjectionModeTag = (currentTags: string | undefined): boolean =>
  hasEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)

export const mergeInjectionModeTag = (currentTags: string | undefined): string =>
  mergeEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)

/**
 * Removes the exact Single-Language injection mode tag only. Callers must track whether the tag pre-existed
 * before merging and call this helper only for a tag they own.
 */
export const removeInjectionModeTag = (currentTags: string | undefined): string | undefined =>
  removeEnvFragment(currentTags, INJECTION_MODE_TAG_FRAGMENT)
