import {getDatadogSite} from '../../helpers/api'
import {getCommonAppBaseURL} from '../../helpers/app'

export const getBaseUrl = () => {
  const site = getDatadogSite()
  const subdomain = process.env.DD_SUBDOMAIN || ''

  return getCommonAppBaseURL(site, subdomain)
}

export const getBaseIntakeUrl = () => {
  return `https://quality-gates.${getDatadogSite()}`
}

/**
 * Receives an array of the form ['key:value', 'key2:value2_1', 'key2:value2_2']
 * and returns an object of the form {key: ['value'], key2: ['value2_1, value2_2']}
 */
export const parseScope = (scope: string[]) => {
  try {
    return scope.reduce((acc: {[key: string]: string[]}, keyValuePair) => {
      if (!keyValuePair.includes(':')) {
        return acc
      }

      const firstColon = keyValuePair.indexOf(':')
      const key = keyValuePair.substring(0, firstColon)
      const value = keyValuePair.substring(firstColon + 1)

      if (acc.hasOwnProperty(key)) {
        if (!acc[key].includes(value)) {
          acc[key].push(value)
        }
      } else {
        acc[key] = [value]
      }

      return acc
    }, {})
  } catch (e) {
    return {}
  }
}

export const getStatus = (error: any) => {
  return error.response?.status
}

export const is4xxError = (error: any) => {
  const status = getStatus(error)

  return status && status >= 400 && status <= 499
}

export const isBadRequestError = (error: any) => {
  const status = getStatus(error)

  return status && status === 400
}

export const is5xxError = (error: any) => {
  const status = getStatus(error)

  return status && status >= 500 && status <= 599
}

export const isTimeout = (error: any) => {
  return error.message === 'wait'
}
