import {request} from 'node:https'

import type {DatadogRoute} from './request/datadog-route'

export class TransportError extends Error {}

/** The dependency-free HTTP boundary. Call sites must use audited Datadog routes. */
export const httpRequest = async (config: {
  url: DatadogRoute
  site: string
  apiKey: string
  signal: AbortSignal
  timeoutMs: number
  data: unknown
}): Promise<number> => {
  const host = config.site === 'datad0g.com' && config.url !== '/api/intake/ci/custom_spans' ? 'app' : 'api'
  const body = JSON.stringify(config.data)
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) {
    throw new Error('Request exceeds 4 MiB')
  }

  return new Promise((resolve, reject) => {
    const outgoing = request(
      `https://${host}.${config.site}${config.url}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'DD-API-KEY': config.apiKey,
          'User-Agent': '@datadog/ci-visibility',
        },
        signal: config.signal,
      },
      (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode || 0))
        response.once('error', () => reject(new TransportError('Response interrupted')))
      }
    )
    // This includes DNS and connection establishment, unlike a socket inactivity timeout.
    const deadline = setTimeout(() => outgoing.destroy(new TransportError('Request timed out')), config.timeoutMs)
    outgoing.once('error', () => reject(new TransportError('Request failed or timed out')))
    outgoing.once('close', () => clearTimeout(deadline))
    outgoing.end(body)
  })
}
