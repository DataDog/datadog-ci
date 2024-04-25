import {exec} from 'child_process'
import fs, {existsSync} from 'fs'
import {promisify} from 'util'

import type {SpanTag, SpanTags} from './interfaces'
import type {AxiosRequestConfig} from 'axios'

import axios from 'axios'
import {BaseContext, CommandClass, Cli} from 'clipanion'
import deepExtend from 'deep-extend'
import {ProxyAgent} from 'proxy-agent'

export const DEFAULT_CONFIG_PATHS = ['datadog-ci.json']

export const pick = <T extends Record<any, any>, K extends keyof T>(base: T, keys: K[]) => {
  const definedKeys = keys.filter((key) => !!base[key])
  const pickedObject: Partial<T> = {}

  for (const key of definedKeys) {
    pickedObject[key] = base[key]
  }

  return pickedObject
}

export const getConfig = async (configPath: string) => {
  try {
    const configFile = await promisify(fs.readFile)(configPath, 'utf-8')

    return JSON.parse(configFile)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Config file is not correct JSON')
    }
  }
}

const resolveConfigPath = ({
  configPath,
  defaultConfigPaths,
}: {
  configPath?: string
  defaultConfigPaths?: string[]
}): string | undefined => {
  if (configPath) {
    if (existsSync(configPath)) {
      return configPath
    }
    throw new Error('Config file not found')
  }

  if (defaultConfigPaths) {
    for (const path of defaultConfigPaths) {
      if (existsSync(path)) {
        return path
      }
    }
  }

  return undefined
}

/**
 * Applies configurations in this order of priority:
 * environment > config file > base config
 */
export const resolveConfigFromFileAndEnvironment = async <
  T extends Record<string, unknown>,
  U extends Record<string, unknown>
>(
  baseConfig: T,
  environment: U,
  params: {
    configPath?: string
    defaultConfigPaths?: string[]
    configFromFileCallback?: (configFromFile: any) => void
  }
): Promise<T & U> => {
  const configFromFile = await resolveConfigFromFile(baseConfig, params)

  if (params.configFromFileCallback) {
    params.configFromFileCallback(configFromFile)
  }

  return deepExtend(configFromFile, removeUndefinedValues(environment))
}

export const resolveConfigFromFile = async <T>(
  baseConfig: T,
  params: {configPath?: string; defaultConfigPaths?: string[]}
): Promise<T> => {
  const resolvedConfigPath = resolveConfigPath(params)
  if (!resolvedConfigPath) {
    return baseConfig
  }
  const parsedConfig = await getConfig(resolvedConfigPath)

  return deepExtend(baseConfig, parsedConfig)
}

/**
 * @deprecated Use resolveConfigFromFile instead for better error management
 */
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
      } as NonNullable<typeof args.headers>,
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

const proxyAgentCache = new Map<string, ProxyAgent>()

export const getProxyAgent = (proxyOpts?: ProxyConfiguration): ProxyAgent => {
  const proxyUrlFromConfiguration = getProxyUrl(proxyOpts)

  let proxyAgent = proxyAgentCache.get(proxyUrlFromConfiguration)
  if (!proxyAgent) {
    proxyAgent = createProxyAgentForUrl(proxyUrlFromConfiguration)
    proxyAgentCache.set(proxyUrlFromConfiguration, proxyAgent)
  }

  return proxyAgent
}

const createProxyAgentForUrl = (proxyUrl: string) => {
  if (!proxyUrl) {
    // Let the default proxy agent discover environment variables.
    return new ProxyAgent()
  }

  return new ProxyAgent({
    getProxyForUrl: (url) => {
      // Do not proxy the WebSocket connections.
      if (url?.match(/^wss?:/)) {
        return ''
      }

      return proxyUrl
    },
  })
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
    // Filter out empty parts
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

export const removeUndefinedValues = <T extends {[key: string]: unknown}>(object: T): T => {
  const newObject = {...object}
  for (const [key, value] of Object.entries(newObject)) {
    if (value === undefined) {
      delete newObject[key]
    }
  }

  return newObject
}

export const normalizeRef = (ref: string | undefined) => {
  if (!ref) {
    return ref
  }

  return ref.replace(/origin\/|refs\/heads\/|tags\//gm, '')
}

export const pluralize = (nb: number, singular: string, plural: string) => {
  if (nb >= 2) {
    return `${nb} ${plural}`
  }

  return `${nb} ${singular}`
}

export const performSubCommand = (command: CommandClass<BaseContext>, commandArgs: string[], context: BaseContext) => {
  const cli = new Cli()
  cli.register(command)

  return cli.run(commandArgs, context)
}

export const filterSensitiveInfoFromRepository = (repositoryUrl: string | undefined) => {
  try {
    if (!repositoryUrl) {
      return repositoryUrl
    }
    if (repositoryUrl.startsWith('git@')) {
      return repositoryUrl
    }
    // Remove the username from ssh URLs
    if (repositoryUrl.startsWith('ssh://')) {
      const sshRegex = /^(ssh:\/\/)[^@/]*@/

      return repositoryUrl.replace(sshRegex, '$1')
    }
    const {protocol, host, pathname} = new URL(repositoryUrl)
    if (!protocol || !host) {
      return repositoryUrl
    }

    return `${protocol}//${host}${pathname === '/' ? '' : pathname}`
  } catch (e) {
    return repositoryUrl
  }
}

// Removes sensitive info from the given git remote url and normalizes the url prefix.
// "git@github.com:" and "https://github.com/" prefixes will be normalized into "github.com/"
export const filterAndFormatGithubRemote = (rawRemote: string | undefined): string | undefined => {
  rawRemote = filterSensitiveInfoFromRepository(rawRemote)
  if (!rawRemote) {
    return rawRemote
  }
  rawRemote = rawRemote.replace(/git@github\.com:|https:\/\/github\.com\//, 'github.com/')

  return rawRemote
}

export const timedExecAsync = async <I, O>(f: (input: I) => Promise<O>, input: I): Promise<number> => {
  const initialTime = Date.now()
  await f(input)

  return (Date.now() - initialTime) / 1000
}

/**
 * Convert bytes to a formatted string in KB, MB, GB, etc.
 * Note: Lambda documentation uses MB (instead of Mib) to refer to 1024 KB, so we follow that style here
 * @param bytes
 * @param decimals
 */
export const formatBytes = (bytes: number, decimals = 2) => {
  if (!bytes) {
    return '0 Bytes'
  }

  if (bytes < 0) {
    throw Error("'bytes' can't be negative.")
  }

  const bytesPerKB = 1024
  const numDecimals = decimals < 0 ? 0 : decimals
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(bytesPerKB))
  const formattedBytes = parseFloat((bytes / Math.pow(bytesPerKB, i)).toFixed(numDecimals))

  return `${formattedBytes} ${units[i]}`
}

// Mask a string to hide sensitive values
export const maskString = (value: string) => {
  // Don't mask booleans
  if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
    return value
  }

  // Dont mask numbers
  if (!isNaN(Number(value))) {
    return value
  }

  // Mask entire string if it's short
  if (value.length < 12) {
    return '*'.repeat(16)
  }

  // Keep first two and last four characters if it's long
  return value.slice(0, 2) + '*'.repeat(10) + value.slice(-4)
}

const execProc = promisify(exec)
export const execute = (cmd: string, cwd?: string): Promise<{stderr: string; stdout: string}> =>
  execProc(cmd, {
    cwd,
    maxBuffer: 5 * 1024 * 5000,
  })
