import upath from 'upath'

export const getMinifiedFilePath = (sourcemapPath: string) => {
  if (upath.extname(sourcemapPath) !== '.map') {
    throw Error('cannot get minified file path from a file which is not a sourcemap')
  }

  return sourcemapPath.replace(new RegExp('\\.map$'), '')
}

// ExtractRepeatedPath checks if the last part of paths of the first arg are repeated at the start of the second arg.
export const extractRepeatedPath = (path1: string, path2: string): string | undefined => {
  const splitOnSlashes = new RegExp(/[\/]+|[\\]+/)
  const trimSlashes = new RegExp(/^[\/]+|^[\\]+|[\/]+$|[\\]+$/)
  const path1split = path1.trim().replace(trimSlashes, '').split(splitOnSlashes)
  const path2split = path2.trim().replace(trimSlashes, '').split(splitOnSlashes)
  const normalizedpath2 = path2split.join('/')
  for (let i = path1split.length; i > 0; i--) {
    const path1subset = path1split.slice(-i).join('/')
    if (normalizedpath2.startsWith(path1subset)) {
      return path1subset
    }
  }

  return undefined
}
