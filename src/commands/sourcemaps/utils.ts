export const getMinifiedFilePath = (sourcemapPath: string): string => sourcemapPath.replace('.min.js.map', '.min.js')

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
