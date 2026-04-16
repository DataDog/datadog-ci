import {PassThrough} from 'stream'

import type {DatadogRoute} from './request/datadog-route'
import type {ThirdPartyRoute} from './request/third-party-route'
import type {Readable} from 'stream'
import type {Dispatcher} from 'undici'

import {EnvHttpProxyAgent, ProxyAgent, fetch} from 'undici'

import {getUserAgent} from './user-agent'

export interface RequestConfig {
  baseURL?: string
  data?: unknown
  dispatcher?: Dispatcher
  headers?: Record<string, string | null | undefined>
  method?: string
  params?: Record<string, unknown>
  paramsSerializer?:
    | ((params: Record<string, unknown>) => string)
    | {serialize: (params: Record<string, unknown>) => string}
  timeout?: number
  url?: DatadogRoute | ThirdPartyRoute
}

export interface RequestResponse<T = any> {
  config: RequestConfig
  data: T
  headers: Record<string, string>
  status: number
  statusText: string
}

export class RequestError extends Error {
  public config: RequestConfig
  public isRequestError = true as const
  public response?: {data: any; status: number; statusText: string}

  constructor(message: string, config: RequestConfig, response?: {data: any; status: number; statusText: string}) {
    super(message)
    this.name = 'RequestError'
    this.config = config
    this.response = response
  }
}

export const isRequestError = (error: unknown): error is RequestError =>
  error instanceof RequestError || (typeof error === 'object' && !!error && (error as any).isRequestError === true)

const dispatcherCache = new Map<string, ProxyAgent>()

export const getProxyDispatcher = (proxyUrl: string): EnvHttpProxyAgent | ProxyAgent => {
  // EnvHttpProxyAgent reads env vars at construction, so never cache it
  if (!proxyUrl) {
    return new EnvHttpProxyAgent()
  }
  let dispatcher = dispatcherCache.get(proxyUrl)
  if (!dispatcher) {
    dispatcher = new ProxyAgent({uri: proxyUrl})
    dispatcherCache.set(proxyUrl, dispatcher)
  }

  return dispatcher
}

const isStream = (body: unknown): body is Readable =>
  typeof body === 'object' && !!body && typeof (body as any).pipe === 'function'

const resolveUrl = (config: RequestConfig): string => {
  const {url, baseURL, params, paramsSerializer} = config
  let resolved: string
  if (baseURL && url && !String(url).startsWith('http://') && !String(url).startsWith('https://')) {
    // Ensure baseURL ends with / for proper URL resolution
    const base = baseURL.endsWith('/') ? baseURL : baseURL + '/'
    // Remove leading / from url to avoid overriding the base path
    const path = String(url).startsWith('/') ? String(url).slice(1) : String(url)
    resolved = new URL(path, base).toString()
  } else {
    resolved = url ?? baseURL ?? ''
  }

  if (params) {
    const serializer = typeof paramsSerializer === 'function' ? paramsSerializer : paramsSerializer?.serialize
    const qs = serializer ? serializer(params) : new URLSearchParams(params as Record<string, string>).toString()
    const separator = resolved.includes('?') ? '&' : '?'
    resolved = `${resolved}${separator}${qs}`
  }

  return resolved
}

const serializeBody = (
  data: unknown,
  headers: Record<string, string | null | undefined>
): {body: unknown; headers: Record<string, string | null | undefined>} => {
  if (data === undefined) {
    return {body: undefined, headers}
  }

  // form-data (npm package) and similar objects that have .pipe but lack Symbol.asyncIterator.
  // undici requires async-iterable bodies; pipe through a PassThrough to make them compatible.
  if (typeof (data as any).pipe === 'function' && !(data as any)[Symbol.asyncIterator]) {
    const passThrough = new PassThrough()
    ;(data as any).pipe(passThrough)

    return {body: passThrough, headers}
  }

  // Proper Node.js Readables / Web ReadableStreams — pass through
  if (isStream(data)) {
    return {body: data, headers}
  }

  // Buffer or string — pass through
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return {body: data, headers}
  }

  // Plain object — JSON serialize
  return {
    body: JSON.stringify(data),
    headers: {'Content-Type': 'application/json', ...headers},
  }
}

const parseResponseHeaders = (headers: Awaited<ReturnType<typeof fetch>>['headers']): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value: string, key: string) => {
    result[key] = value
  })

  return result
}

export const httpRequest = async <T = any>(config: RequestConfig): Promise<RequestResponse<T>> => {
  const resolvedUrl = resolveUrl(config)
  const method = (config.method ?? 'GET').toUpperCase()
  const {body, headers} = serializeBody(config.data, config.headers ?? {})
  const headersWithUserAgent = {...headers, 'User-Agent': getUserAgent()}

  // Strip null/undefined header values (callers pass null to explicitly unset a header)
  const cleanHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headersWithUserAgent)) {
    // eslint-disable-next-line no-null/no-null
    if (v !== undefined && v !== null) {
      cleanHeaders[k] = String(v)
    }
  }

  const fetchOptions: Record<string, any> = {
    method,
    headers: cleanHeaders,
    body,
    dispatcher: config.dispatcher,
    duplex: body !== undefined && isStream(config.data) ? 'half' : undefined,
  }

  if (config.timeout) {
    fetchOptions.signal = AbortSignal.timeout(config.timeout)
  }

  let response: Awaited<ReturnType<typeof fetch>>
  try {
    response = await fetch(resolvedUrl, fetchOptions)
  } catch (error: any) {
    const message = error.cause?.message ?? error.message ?? 'Request failed'
    const requestError = new RequestError(message, config)
    const code = error.code ?? error.cause?.code
    if (code) {
      ;(requestError as any).code = code
    }
    throw requestError
  }

  const responseHeaders = parseResponseHeaders(response.headers)
  const mediaType = (responseHeaders['content-type'] ?? '').split(';')[0].trim()
  const rawBody = await response.text()
  let data: any = rawBody
  if (rawBody.length > 0 && (mediaType === 'application/json' || mediaType === 'application/vnd.api+json')) {
    try {
      data = JSON.parse(rawBody)
    } catch {
      // keep as text
    }
  }

  if (!response.ok) {
    const message = `Request failed with status code ${response.status}`
    throw new RequestError(message, config, {
      data,
      status: response.status,
      statusText: response.statusText,
    })
  }

  return {
    config,
    data,
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  }
}
