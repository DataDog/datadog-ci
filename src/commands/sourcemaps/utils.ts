import path from 'path'

export const getMinifiedFilePath = (sourcemapPath: string) => {
  if (path.extname(sourcemapPath) !== '.map') {
    throw Error('cannot get minified file path from a file which is not a sourcemap')
  }

  return sourcemapPath.replace(new RegExp('\\.map$'), '')
}

export const getBaseIntakeUrl = () => {
  if (process.env.DATADOG_SOURCEMAP_INTAKE_URL) {
    return process.env.DATADOG_SOURCEMAP_INTAKE_URL
  } else if (process.env.DATADOG_SITE) {
    return 'https://sourcemap-intake.' + process.env.DATADOG_SITE
  }

  return 'https://sourcemap-intake.datadoghq.com'
}

export const getBaseAPIUrl = () => {
  if (process.env.DATADOG_SITE) {
    return 'api.' + process.env.DATADOG_SITE
  }

  return 'api.datadoghq.com'
}

// The buildPath function is used to concatenate several paths. The goal is to have a function working for both unix
// paths and URL whereas standard path.join does not work with both.
export const buildPath = (...args: string[]) =>
  args
    .map((part, i) => {
      if (i === 0) {
        // For the first part, drop all / at the end of the path
        return part.trim().replace(/[\/]*$/g, '')
      } else {
        // For the following parts, remove all / at the beginning and at the end
        return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
      }
    })
    // Filter out emtpy parts
    .filter((x) => x.length)
    // Join all these parts with /
    .join('/')

export const pluralize = (nb: number, singular: string, plural: string) => {
  if (nb >= 2) {
    return `${nb} ${plural}`
  }

  return `${nb} ${singular}`
}
