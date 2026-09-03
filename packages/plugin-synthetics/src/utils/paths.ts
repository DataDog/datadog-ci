/**
 * A dot-separated property path, e.g. `'test.name'`. A segment can end with `[]` to project over every element
 * of an array at that key, e.g. `'result.steps[].failure.message'`.
 */
export type FieldPath = string

const WILDCARD_SUFFIX = '[]'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  // eslint-disable-next-line no-null/no-null
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Copies the value at `path` from `source` into `target`, creating intermediate objects/arrays as needed.
 * Does nothing if `source` doesn't have a value at `path` (including because an intermediate array is empty
 * or missing) -- crucially, this must never leave behind a stray empty `{}` for an intermediate key whose
 * deeper value didn't actually exist, which is why every branch reports back whether it wrote anything.
 * Never mutates `source`; only ever mutates `target` (and objects/arrays it already owns).
 */
const assignPath = (target: Record<string, unknown>, source: unknown, segments: string[]): boolean => {
  if (!isPlainObject(source)) {
    return false
  }

  const [rawSegment, ...rest] = segments
  const isWildcard = rawSegment.endsWith(WILDCARD_SUFFIX)
  const key = isWildcard ? rawSegment.slice(0, -WILDCARD_SUFFIX.length) : rawSegment

  if (!(key in source)) {
    return false
  }

  const value = source[key]

  if (isWildcard) {
    if (!Array.isArray(value)) {
      return false
    }
    if (rest.length === 0) {
      target[key] = value

      return true
    }

    // The array itself is kept once found, at every index, even if a given element has nothing at `rest`
    // (as an empty `{}`) -- unlike a single nested object, dropping an element here would misalign indices.
    const projected: Record<string, unknown>[] = Array.isArray(target[key])
      ? (target[key] as Record<string, unknown>[])
      : []
    value.forEach((item, index) => {
      const element = projected[index] ?? {}
      assignPath(element, item, rest)
      projected[index] = element
    })
    target[key] = projected

    return true
  }

  if (rest.length === 0) {
    target[key] = value

    return true
  }

  if (!isPlainObject(value)) {
    return false
  }

  const child = isPlainObject(target[key]) ? (target[key] as Record<string, unknown>) : {}
  const wrote = assignPath(child, value, rest)
  if (wrote) {
    target[key] = child
  }

  return wrote
}

/**
 * Builds a new object containing only the values found in `source` at `paths`, preserving their nested shape.
 * A path with no value in `source` (including a missing intermediate key) is silently omitted.
 */
export const pickPaths = <T>(source: unknown, paths: readonly FieldPath[]): T => {
  const result: Record<string, unknown> = {}
  for (const path of paths) {
    assignPath(result, source, path.split('.'))
  }

  return result as T
}

// Plain objects are merged key by key; anything else present in `patch` (including arrays) fully replaces
// the corresponding value in `base`, rather than being merged element-wise.
const mergeDeep = <T>(base: T, patch: unknown): T => {
  if (patch === undefined) {
    return base
  }
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch as T
  }

  const result: Record<string, unknown> = {...base}
  for (const key of Object.keys(patch)) {
    result[key] = mergeDeep(base[key], patch[key])
  }

  return result as T
}

/**
 * Returns a new object equal to `base`, with only the values found in `source` at `paths` overridden
 * (a path missing from `source` leaves `base`'s own value untouched). Never mutates `base` or `source`.
 */
export const withPaths = <T extends object>(base: T, source: unknown, paths: readonly FieldPath[]): T =>
  mergeDeep(base, pickPaths(source, paths))
