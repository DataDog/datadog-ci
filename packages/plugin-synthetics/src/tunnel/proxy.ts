import {request as httpRequest} from 'http'
import {request as httpsRequest} from 'https'
import {isIPv6} from 'net'

import type {Socket} from 'net'

export const connectThroughProxy = (proxyUrl: string, host: string, port: number, timeout: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const {protocol, hostname, port: proxyPort, username, password} = new URL(proxyUrl)
    if (protocol !== 'http:' && protocol !== 'https:') {
      return reject(new Error(`Unsupported proxy protocol for tunneled traffic: ${protocol}`))
    }

    const target = `${isIPv6(host) ? `[${host}]` : host}:${port}`
    const headers: Record<string, string> = {Host: target}
    if (username) {
      const credentials = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`
    }

    const request = (protocol === 'https:' ? httpsRequest : httpRequest)({
      headers,
      host: hostname.replace(/^\[|\]$/g, ''),
      method: 'CONNECT',
      path: target,
      port: proxyPort || (protocol === 'https:' ? 443 : 80),
      timeout,
    })

    request.on('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy()

        return reject(new Error(`Proxy responded with status ${response.statusCode}`))
      }
      if (head.length) {
        socket.unshift(head)
      }
      resolve(socket)
    })
    request.on('timeout', () => request.destroy(new Error('Proxy connection timeout')))
    request.on('error', reject)
    request.end()
  })
