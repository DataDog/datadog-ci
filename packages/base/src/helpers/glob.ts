// eslint-disable-next-line no-restricted-imports
import * as globModule from 'glob'
import upath from 'upath'

const {hasMagic} = globModule

export {hasMagic}

/**
 * Synchronous form of `glob` which returns `upath`-normalized paths.
 */
export const globSync = (pattern: string, opts?: globModule.GlobOptionsWithFileTypesFalse) => {
  const results = globModule.sync(pattern, {...opts})

  return results.map((path) => upath.normalizeSafe(path))
}

/**
 * Asynchronous form of `glob` which returns `upath`-normalized paths.
 */
export const globAsync = async (pattern: string, opts?: globModule.GlobOptionsWithFileTypesFalse) => {
  const results = await globModule.glob(pattern, {...opts})

  return results.map((path) => upath.normalizeSafe(path))
}

export const parsePathsList = (paths: string | undefined): string[] => {
  if (!paths) {
    return []
  }

  return paths
    .split(',')
    .flatMap((path) => (globModule.hasMagic(path) ? globSync(path, {dotRelative: true}) : [path]))
    .map((path) => (path.endsWith('/') ? path.slice(0, -1) : path))
}
