import fs from 'fs'
import {promisify} from 'util'

import {AxiosRequestConfig, default as axios} from 'axios'
import deepExtend from 'deep-extend'
import ProxyAgent from 'proxy-agent'

export function pick<T extends object, K extends keyof T>(base: T, keys: K[]) {
  const definedKeys = keys.filter((key) => !!base[key])
  const pickedObject: Partial<T> = {}

  for (const key of definedKeys) {
    pickedObject[key] = base[key]
  }

  return pickedObject
}

export const parseConfigFile = async <T>(baseConfig: T, configPath?: string) => {
  try {
    const resolvedConfigPath = configPath ?? 'datadog-ci.json'
    const configFile = await promisify(fs.readFile)(resolvedConfigPath, 'utf-8')
    const parsedConfig = JSON.parse(configFile)

    return deepExtend(baseConfig, parsedConfig) as T
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

export const requestBuilder = (baseUrl: string, apiKey: string, appKey?: string, proxyOpts?: ProxyConfiguration) => {
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
      newArguments.httpsAgent = new ProxyAgent(proxyOpts)
    }

    return newArguments
  }

  return (args: AxiosRequestConfig) => axios.create({baseURL: baseUrl})(overrideArgs(args))
}
