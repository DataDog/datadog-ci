import path from 'path'

export const getMinifiedFilePath = (sourcemapPath: string) => {
  if (path.extname(sourcemapPath) !== '.map') {
    throw Error('cannot get minified file path from a file which is not a sourcemap')
  }

  return sourcemapPath.replace(new RegExp('\\.map$'), '')
}

// extractRepeatedPath checks if the last part of paths of the first arg are found at the start of the second arg. 
export const extractRepeatedPath = (path1: string, path2: string): string | undefined => {
  let splitOnSlashes = new RegExp(/[\/]+|[\\]+/)
  let trimSlashes = new RegExp(/^[\/]+|^[\\]+|[\/]+$|[\\]+$/)
  let path1split = path1.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let path2split = path2.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let normalizedpath2 = path2split.join('/')
  for (var i = path1split.length; i > 0; i--) {
    var path1subset = path1split.slice(-i).join('/')
    if(normalizedpath2.startsWith(path1subset)) {
      return path1subset;
    }
  }
  return undefined;
}
