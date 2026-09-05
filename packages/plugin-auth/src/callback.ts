import http from 'node:http'

import type {Readable, Writable} from 'node:stream'

import {CALLBACK_PATH, CALLBACK_PORTS} from './oauth'

export interface OAuthCallback {
  code: string
  domain?: string
}

const escapeHTML = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const parseCallbackUrl = (value: string, expectedState: string): OAuthCallback => {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter the complete localhost redirect URL from your browser.')
  }
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.pathname !== CALLBACK_PATH) {
    throw new Error(`Expected an http://localhost URL ending in ${CALLBACK_PATH}.`)
  }
  const error = url.searchParams.get('error')
  if (error) {
    const description = url.searchParams.get('error_description')
    throw new Error(`OAuth authorization was denied: ${description || error}`)
  }
  if (url.searchParams.get('state') !== expectedState) {
    throw new Error('OAuth callback state did not match. Please start login again.')
  }
  const code = url.searchParams.get('code')
  if (!code) {
    throw new Error('OAuth callback did not include an authorization code.')
  }

  return {code, domain: url.searchParams.get('domain') || undefined}
}

export interface CallbackServer {
  callback: Promise<OAuthCallback>
  close: () => Promise<void>
  port: number
}

const listen = (server: http.Server, port: number) =>
  new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => reject(error)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

export const startCallbackServer = async (expectedState: string, selectedPort?: number): Promise<CallbackServer> => {
  let resolveCallback!: (callback: OAuthCallback) => void
  let rejectCallback!: (error: Error) => void
  const callback = new Promise<OAuthCallback>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (requestUrl.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end('Not found')

      return
    }
    try {
      const parsed = parseCallbackUrl(`http://localhost${request.url}`, expectedState)
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'})
      response.end('<!doctype html><title>Datadog CLI authenticated</title><p>You can close this window.</p>')
      resolveCallback(parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      response.writeHead(400, {'Content-Type': 'text/html; charset=utf-8'})
      response.end(`<!doctype html><title>Authentication failed</title><p>${escapeHTML(message)}</p>`)
      if (message.includes('state did not match') || message.includes('authorization was denied')) {
        rejectCallback(new Error(message))
      }
    }
  })

  const ports = selectedPort === undefined ? CALLBACK_PORTS : [selectedPort]
  let port: number | undefined
  for (const candidate of ports) {
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > 65535) {
      throw new Error(`Invalid callback port ${candidate}. Expected an integer from 1 to 65535.`)
    }
    try {
      await listen(server, candidate)
      port = candidate
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || selectedPort !== undefined) {
        throw error
      }
    }
  }
  if (port === undefined) {
    throw new Error(`No callback port is available. Tried: ${ports.join(', ')}`)
  }

  return {
    callback,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    port,
  }
}

export const readManualCallback = (
  stdin: Readable & {isTTY?: boolean},
  stdout: Writable,
  expectedState: string,
  signal?: AbortSignal
): Promise<OAuthCallback> => {
  if (!stdin.isTTY) {
    return Promise.reject(new Error('Manual browser login requires an interactive stdin terminal.'))
  }

  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString()
      const newline = buffer.indexOf('\n')
      if (newline < 0) {
        return
      }
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      try {
        const parsed = parseCallbackUrl(line, expectedState)
        cleanup()
        resolve(parsed)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('state did not match') || message.includes('authorization was denied')) {
          cleanup()
          reject(new Error(message))
        } else {
          stdout.write(`${message}\nPaste the complete redirect URL: `)
        }
      }
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('stdin closed before an OAuth callback URL was received.'))
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('OAuth callback input was cancelled.'))
    }
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.off('end', onEnd)
      signal?.removeEventListener('abort', onAbort)
    }
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    signal?.addEventListener('abort', onAbort, {once: true})
    stdin.resume()
  })
}

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OAuth login timed out after five minutes.')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
