import {createServer, request as localRequest} from 'node:http'
import https from 'node:https'

import {createRecorder} from '..'
import * as transport from '../request'
import {datadogRoute} from '../request/datadog-route'
import {upload} from '../upload'

import {fixture} from './helpers'

const requests = (count: number) =>
  Array.from({length: count}, (_, i) => ({
    method: 'POST' as const,
    url: datadogRoute('/api/v2/ci/pipeline/tags'),
    data: {data: {value: i}},
    recordIds: [String(i)],
  }))

describe('bounded uploads', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  test('retries HTTP failures and keeps concurrency at four', async () => {
    let active = 0
    let maximum = 0
    const send = jest.spyOn(transport, 'httpRequest').mockImplementation(async () => {
      maximum = Math.max(maximum, ++active)
      await Promise.resolve()
      active--

      return send.mock.calls.length <= 4 ? 429 : 202
    })
    const promise = upload(requests(8), {apiKey: 'test'})
    expect(await promise).toMatchObject({sent: 8, failed: 0, skipped: 0})
    expect(maximum).toBeLessThanOrEqual(4)
    expect(send.mock.calls.length).toBeGreaterThan(8)
  })

  test('does not retry HTTP 4xx and caps retries for server errors', async () => {
    const send = jest.spyOn(transport, 'httpRequest').mockResolvedValue(503)
    const warning = jest.fn()
    const pending = upload(requests(1), {apiKey: 'test', onWarning: warning})
    expect(await pending).toMatchObject({sent: 0, failed: 1})
    expect(send).toHaveBeenCalledTimes(3)
    send.mockClear().mockResolvedValue(403)
    await upload(requests(1), {apiKey: 'test', onWarning: warning})
    expect(send).toHaveBeenCalledTimes(1)
  })

  test('stops scheduling after a transport failure', async () => {
    const send = jest.spyOn(transport, 'httpRequest').mockRejectedValue(new transport.TransportError('unreachable'))
    const result = await upload(requests(20), {apiKey: 'test', onWarning: jest.fn()})
    expect(result.sent).toBe(0)
    expect(result.failed + result.skipped).toBe(20)
    expect(send.mock.calls.length).toBeLessThanOrEqual(4)
  })

  test('aborts in-flight requests at the overall deadline', async () => {
    jest.useFakeTimers()
    jest.spyOn(transport, 'httpRequest').mockImplementation(
      async ({signal}) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new transport.TransportError('aborted')), {once: true})
        })
    )
    const pending = upload(requests(20), {apiKey: 'test', timeoutMs: 10, onWarning: jest.fn()})
    await jest.advanceTimersByTimeAsync(10)
    expect(await pending).toMatchObject({sent: 0, failed: 4, skipped: 16, completedIds: []})
  })

  test('validates credentials and destination before HTTP', async () => {
    const send = jest.spyOn(transport, 'httpRequest').mockResolvedValue(202)
    const warning = jest.fn()
    expect(await upload(requests(1), {apiKey: 'test', site: 'example.com', onWarning: warning})).toMatchObject({
      skipped: 1,
    })
    expect(await upload(requests(1), {apiKey: 'test', timeoutMs: 0, onWarning: warning})).toMatchObject({skipped: 1})
    expect(send).not.toHaveBeenCalled()
  })

  test('sends the expected paths, payloads, and headers through the HTTP boundary', async () => {
    const received: {path?: string; body: unknown; key?: string}[] = []
    const server = createServer((incoming, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of incoming) {
          chunks.push(Buffer.from(chunk))
        }
        received.push({
          path: incoming.url,
          body: JSON.parse(Buffer.concat(chunks).toString()),
          key: incoming.headers['dd-api-key'] as string,
        })
        response.writeHead(202)
        response.end('{}')
      })().catch(() => response.destroy())
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Missing server port')
    }
    // Redirect only in the test: production requests retain the audited HTTPS destination.
    jest.spyOn(https, 'request').mockImplementation((...args: any[]) => {
      const [url, options, listener] = args
      expect(new URL(url).origin).toBe('https://api.datadoghq.com')

      return localRequest(
        {hostname: '127.0.0.1', port: address.port, path: new URL(url).pathname, ...options},
        listener
      )
    })
    const data = fixture()
    try {
      const recorder = createRecorder({env: {...data.env, DD_API_KEY: 'test-only'}})
      await recorder.span('Build', (span) => span.setMeasure('output.bytes', 12))
      recorder.setTags({version: '1'})
      recorder.setMeasure('duration', 1)
      expect(await recorder.flush()).toEqual({sent: 3, failed: 0, skipped: 0})
      expect(received.map((item) => item.path).sort()).toEqual([
        '/api/intake/ci/custom_spans',
        '/api/v2/ci/pipeline/metrics',
        '/api/v2/ci/pipeline/tags',
      ])
      expect(received.every((item) => item.key === 'test-only')).toBe(true)
      expect(received.find((item) => item.path?.endsWith('metrics'))?.body).toMatchObject({
        data: {type: 'ci_custom_metric', attributes: {metrics: {duration: 1}, ci_level: 1}},
      })
      server.removeAllListeners('request')
      server.on('request', (incoming) => incoming.resume())
      const stalled = await upload(requests(10), {
        apiKey: 'test-only',
        requestTimeoutMs: 15,
        timeoutMs: 1000,
        onWarning: jest.fn(),
      })
      expect(stalled.sent).toBe(0)
      expect(stalled.failed).toBeLessThanOrEqual(4)
      expect(stalled.failed + stalled.skipped).toBe(10)
    } finally {
      data.cleanup()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  })
})
