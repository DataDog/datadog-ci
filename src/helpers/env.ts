export const toBoolean = (env: string | undefined): boolean | undefined => {
  if (env === undefined) {
    return undefined
  }

  if (env.toLowerCase() === 'true' || env === '1') {
    return true
  }

  if (env.toLowerCase() === 'false' || env === '0') {
    return false
  }

  return undefined
}

export const toNumber = (env: string | undefined): number | undefined => {
  if (env === undefined || env.trim() === '') {
    return undefined
  }

  const number = Number(env)

  if (isNaN(number)) {
    return undefined
  }

  return number
}

export const toStringMap = (env: string | undefined): StringMap | undefined => {
  if (env === undefined) {
    return undefined
  }
  const cleanedEnv = env.replace(/'/g, '"')

  try {
    const parsed = JSON.parse(cleanedEnv)
    // eslint-disable-next-line no-null/no-null
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key in parsed as object) {
        if (typeof parsed[key] !== 'string') {
          return undefined
        }
      }

      return parsed as StringMap
    }
  } catch (error) {
    return undefined
  }
}

export type StringMap = {[key: string]: string}
