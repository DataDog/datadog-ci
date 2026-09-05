import http from 'node:http'
import {PassThrough} from 'node:stream'

import {parseCallbackUrl, readManualCallback, startCallbackServer, withTimeout} from '../callback'

describe('OAuth callback', () => {
  test('parses a successful localhost redirect', () => {
    expect(
      parseCallbackUrl(
        'http://localhost:8000/oauth/callback?code=secret-code&state=expected&domain=datadoghq.eu',
        'expected'
      )
    ).toEqual({code: 'secret-code', domain: 'datadoghq.eu'})
  })

  test.each([
    ['not a url', 'complete localhost'],
    ['https://localhost:8000/oauth/callback?code=x&state=s', 'Expected an http://localhost'],
    ['http://localhost:8000/wrong?code=x&state=s', 'ending in /oauth/callback'],
    ['http://localhost:8000/oauth/callback?code=x&state=wrong', 'state did not match'],
    ['http://localhost:8000/oauth/callback?state=s', 'authorization code'],
    ['http://localhost:8000/oauth/callback?error=access_denied&error_description=No&state=s', 'denied: No'],
  ])('rejects invalid callback %s', (url, message) => {
    expect(() => parseCallbackUrl(url, 's')).toThrow(message)
  })

  test('times out a callback wait', async () => {
    await expect(withTimeout(new Promise<never>(() => undefined), 1)).rejects.toThrow('timed out')
  })

  test('rejects non-interactive manual input without waiting', async () => {
    const stdin = Object.assign(new PassThrough(), {isTTY: false})
    await expect(readManualCallback(stdin, new PassThrough(), 'state')).rejects.toThrow('interactive stdin')
  })

  test('allows retrying a malformed pasted URL', async () => {
    const stdin = Object.assign(new PassThrough(), {isTTY: true})
    let output = ''
    const stdout = new PassThrough()
    stdout.on('data', (chunk) => (output += chunk.toString()))
    const callback = readManualCallback(stdin, stdout, 'state')
    stdin.write('not-a-url\n')
    stdin.write('http://localhost:8000/oauth/callback?code=code&state=state\n')
    await expect(callback).resolves.toEqual({code: 'code', domain: undefined})
    expect(output).toContain('complete localhost redirect URL')
  })

  test('reports an explicitly busy port and releases a successful listener', async () => {
    const busy = http.createServer()
    await new Promise<void>((resolve) => busy.listen(32191, '127.0.0.1', resolve))
    await expect(startCallbackServer('state', 32191)).rejects.toMatchObject({code: 'EADDRINUSE'})
    await new Promise<void>((resolve) => busy.close(() => resolve()))

    const callbackServer = await startCallbackServer('state', 32191)
    await callbackServer.close()
    const rebound = http.createServer()
    await new Promise<void>((resolve) => rebound.listen(32191, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => rebound.close(() => resolve()))
  })

  test('escapes OAuth errors in the browser response', async () => {
    const callbackServer = await startCallbackServer('state', 32192)
    const rejection = callbackServer.callback.then(
      () => undefined,
      (error) => error as Error
    )
    const response = await fetch(
      'http://127.0.0.1:32192/oauth/callback?error=access_denied&error_description=%3Cscript%3Ebad%3C%2Fscript%3E&state=state'
    )
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect((await rejection)?.message).toContain('authorization was denied')
    await callbackServer.close()
  })
})
