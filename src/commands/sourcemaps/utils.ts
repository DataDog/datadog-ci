import path from 'path'

export const getMinifiedFilePath = (sourcemapPath: string) => {
  if (path.extname(sourcemapPath) !== '.map') {
    throw Error('cannot get minified file path from a file which is not a sourcemap')
  }

  return sourcemapPath.replace(new RegExp('\\.map$'), '')
}

// arelastFoldersRepeated checks if the last folders of the first arg are found within the second. 
export const arelastFoldersRepeated = (path1: string, path2: string): boolean => {
  let splitOnSlashes = new RegExp(/[\/]+|[\\]+/)
  let trimSlashes = new RegExp(/^[\/]+|^[\\]+|[\/]+$|[\\]+$/)
  let path1split = path1.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let path2split = path2.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let normalizedpath2 = path2split.join('/')
  for (var i = path1split.length; i > 0; i--) {
    var path1subset = path1split.slice(-i).join('/')
    console.log(path1subset+' => '+normalizedpath2+'\n')
    if(normalizedpath2.startsWith(path1subset)) {
      return true;
    }
  }
  return false
}

// islastFolderRepeated checks if the last folder of the first arg is found within the second. 
export const islastFolderRepeated = (path1: string, path2: string): boolean => {
  let splitOnSlashes = new RegExp(/[\/]+|[\\]+/)
  let trimSlashes = new RegExp(/^[\/]+|^[\\]+|[\/]+$|[\\]+$/)
  let path1split = path1.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let path2split = path2.trim().replace(trimSlashes, '').split(splitOnSlashes)
  let lastFolder = path1split[path1split.length-1]
  return path2split.includes(lastFolder)
}
