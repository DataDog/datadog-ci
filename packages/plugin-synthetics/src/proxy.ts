import type {Agent} from 'http'
import type {Dispatcher} from 'undici'

import {getProxyDispatcher as getBaseProxyDispatcher} from '@datadog/datadog-ci-base/helpers/request'
import {ProxyAgent} from 'proxy-agent'

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

const proxyAgentCache = new Map<string, ProxyAgent>()

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

export const getSyntheticsProxyDispatcher = (proxyOpts?: ProxyConfiguration): Dispatcher | undefined => {
  const proxyUrl = getProxyUrl(proxyOpts)

  if (!proxyUrl) {
    return undefined
  }

  return getBaseProxyDispatcher(proxyUrl)
}

export const getTunnelProxyAgent = (proxyOpts?: ProxyConfiguration): Agent => {
  const proxyUrl = getProxyUrl(proxyOpts)

  if (!proxyUrl) {
    // ProxyAgent reads env vars at construction, so never cache it.
    return new ProxyAgent()
  }

  let proxyAgent = proxyAgentCache.get(proxyUrl)
  if (!proxyAgent) {
    proxyAgent = createTunnelProxyAgent(proxyUrl)
    proxyAgentCache.set(proxyUrl, proxyAgent)
  }

  return proxyAgent
}

const createTunnelProxyAgent = (proxyUrl: string) =>
  new ProxyAgent({
    getProxyForUrl: (url) => {
      // Keep the existing behavior for ws internals while still routing the tunnel through the proxy.
      if (url?.match(/^wss?:/)) {
        return ''
      }

      return proxyUrl
    },
  })
