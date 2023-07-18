import * as http from 'http'
import * as https from 'https'

import {Agent, AgentConnectOpts} from 'agent-base'
import {HttpProxyAgent} from 'http-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import {getProxyForUrl} from 'proxy-from-env'
import {SocksProxyAgent} from 'socks-proxy-agent'

type ProxyType = 'http' | 'https' | 'socks' | 'socks4' | 'socks4a' | 'socks5' | 'socks5h'

export interface ProxyConfiguration {
  auth?: {
    password: string
    username: string
  }
  host?: string
  port?: number
  protocol: ProxyType
}

export class ProxyAgent extends Agent {
  private httpAgent: http.Agent
  private httpsAgent: http.Agent

  constructor() {
    super()
    this.httpAgent = new http.Agent()
    this.httpsAgent = new https.Agent()
  }

  public async connect(req: http.ClientRequest, opts: AgentConnectOpts): Promise<http.Agent> {
    const {secureEndpoint} = opts

    const protocol = secureEndpoint ? 'https:' : 'http:'
    const host = req.getHeader('host')
    const url = new URL(req.path, `${protocol}//${host}`).href

    const proxyUrl = getProxyForUrl(url)
    if (proxyUrl) {
      const proxyAgent = getProxyAgentForUrl(proxyUrl)
      if (proxyAgent) {
        return proxyAgent
      }
    }

    return secureEndpoint ? this.httpsAgent : this.httpAgent
  }

  public destroy(): void {
    // for (const agent of this.cache.values()) {
    //   agent.destroy()
    // }
    super.destroy()
  }
}

export const getProxyUrlFromConfiguration = (options?: ProxyConfiguration): string => {
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

export const getProxyAgent = (proxyOpts?: ProxyConfiguration): http.Agent | undefined => {
  const proxyUrlFromConfiguration = getProxyUrlFromConfiguration(proxyOpts)
  if (proxyUrlFromConfiguration) {
    return getProxyAgentForUrl(proxyUrlFromConfiguration)
  }

  return new ProxyAgent() as http.Agent
}

const getProxyAgentForUrl = (proxyUrl: string) => {
  const {protocol} = new URL(proxyUrl)
  if (protocol === 'http:') {
    return new HttpProxyAgent(proxyUrl)
  } else if (protocol === 'https:') {
    return new HttpsProxyAgent(proxyUrl)
  } else if (protocol.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl)
  }
}
