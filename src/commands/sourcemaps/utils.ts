export const getMinifiedFilePath = (sourcemapPath: string): string => sourcemapPath.replace(new RegExp('\\.map$'), '')

export const buildPath = (...args: string[]): string =>
  args
    .map((part, i) => {
      if (i === 0) {
        return part.trim().replace(/[\/]*$/g, '')
      } else {
        return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
      }
    })
    .filter((x) => x.length)
    .join('/')
