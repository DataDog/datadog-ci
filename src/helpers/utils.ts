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

export const getProxyUrl = (options: ProxyConfiguration) => {
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
  disableEnvironmentVariables?: boolean
  proxyOpts?: ProxyConfiguration
}

export const getRequestBuilder = (options: RequestOptions) => {
  const {apiKey, appKey, baseUrl, disableEnvironmentVariables, proxyOpts} = options
  const overrideArgs = (args: AxiosRequestConfig) => {
    const newArguments = {
      ...args,
      headers: {
        'DD-API-KEY': apiKey,
        ...(appKey ? {'DD-APPLICATION-KEY': appKey} : {}),
        ...args.headers,
      },
    }

    if (proxyOpts && proxyOpts.host && proxyOpts.port) {
      const proxyUrl = getProxyUrl(proxyOpts)
      newArguments.httpsAgent = new ProxyAgent(proxyUrl)
    }

    return newArguments
  }

  const baseConfiguration: AxiosRequestConfig = {
    baseURL: baseUrl,
  }

  if (disableEnvironmentVariables) {
    baseConfiguration.proxy = false
  }

  return (args: AxiosRequestConfig) => axios.create(baseConfiguration)(overrideArgs(args))
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

export type Logger = (s: string) => void
