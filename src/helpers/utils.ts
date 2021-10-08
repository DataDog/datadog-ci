import fs from 'fs'
import {promisify} from 'util'

import {AxiosRequestConfig, default as axios} from 'axios'
import deepExtend from 'deep-extend'
import ProxyAgent from 'proxy-agent'

import type {SpanTag, SpanTags} from './interfaces'

export const pick = <T extends object, K extends keyof T>(base: T, keys: K[]) => {
  const definedKeys = keys.filter((key) => !!base[key])
  const pickedObject: Partial<T> = {}

  for (const key of definedKeys) {
    pickedObject[key] = base[key]
  }

  return pickedObject
}

export const getConfig = async (configPath: string) => {
  const configFile = await promisify(fs.readFile)(configPath, 'utf-8')

  return JSON.parse(configFile)
}

export const parseConfigFile = async <T>(baseConfig: T, configPath?: string): Promise<T> => {
  try {
    const resolvedConfigPath = configPath ?? 'datadog-ci.json'
    const parsedConfig = await getConfig(resolvedConfigPath)

    return deepExtend(baseConfig, parsedConfig)
  } catch (e) {
    if (e.code === 'ENOENT' && configPath) {
      throw new Error('Config file not found')
    }

    if (e instanceof SyntaxError) {
      throw new Error('Config file is not correct JSON')
    }
  }

  return baseConfig
}

type ProxyType =
  | 'http'
  | 'https'
  | 'socks'
  | 'socks4'
  | 'socks4a'
  | 'socks5'
  | 'socks5h'
  | 'pac+data'
  | 'pac+file'
  | 'pac+ftp'
  | 'pac+http'
  | 'pac+https'

export interface ProxyConfiguration {
  auth?: {
    password: string
    username: string
  }
  host?: string
  port?: number
  protocol: ProxyType
}

export const getProxyUrl = (options?: ProxyConfiguration): string => {
  if (!options) {
    return ''
  }

  const {auth, host, port, protocol} = options

  if (!host || !port) {
    return ''
  }

  const authFragment = auth ? `${auth.username}:${auth.password}@` : ''

  return `${protocol}://${authFragment}${host}:${port}`
}

export interface RequestOptions {
  apiKey: string
  appKey?: string
  baseUrl: string
  headers?: Map<string, string>
  overrideUrl?: string
  proxyOpts?: ProxyConfiguration
}

export const getRequestBuilder = (options: RequestOptions) => {
  const {apiKey, appKey, baseUrl, overrideUrl, proxyOpts} = options
  const overrideArgs = (args: AxiosRequestConfig) => {
    const newArguments = {
      ...args,
      headers: {
        'DD-API-KEY': apiKey,
        ...(appKey ? {'DD-APPLICATION-KEY': appKey} : {}),
        ...args.headers,
      },
    }

    if (overrideUrl !== undefined) {
      newArguments.url = overrideUrl
    }

    const proxyAgent = getProxyAgent(proxyOpts)
    if (proxyAgent) {
      newArguments.httpAgent = proxyAgent
      newArguments.httpsAgent = proxyAgent
    }

    if (options.headers !== undefined) {
      options.headers.forEach((value, key) => {
        newArguments.headers[key] = value
      })
    }

    return newArguments
  }

  const baseConfiguration: AxiosRequestConfig = {
    baseURL: baseUrl,
    // Disabling proxy in Axios config as it's not working properly
    // the passed httpAgent/httpsAgent are handling the proxy instead.
    proxy: false,
  }

  return (args: AxiosRequestConfig) => axios.create(baseConfiguration)(overrideArgs(args))
}

export const getProxyAgent = (proxyOpts?: ProxyConfiguration): ReturnType<typeof ProxyAgent> => {
  const proxyUrlFromConfiguration = getProxyUrl(proxyOpts)

  return new ProxyAgent(proxyUrlFromConfiguration)
}

export const getApiHostForSite = (site: string) => {
  switch (site) {
    case 'datad0g.com':
      return `app.${site}`
    case 'datadoghq.com':
    case 'datadoghq.eu':
    default:
      return `api.${site}`
  }
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

export const removeEmptyValues = (tags: SpanTags) =>
  (Object.keys(tags) as SpanTag[]).reduce((filteredTags, tag) => {
    if (!tags[tag]) {
      return filteredTags
    }

    return {
      ...filteredTags,
      [tag]: tags[tag],
    }
  }, {})

export const removeUndefinedValues = <T extends {[key: string]: any}>(object: T): T => {
  const newObject = {...object}
  for (const [key, value] of Object.entries(newObject)) {
    if (value === undefined) {
      delete newObject[key]
    }
  }

  return newObject
}
