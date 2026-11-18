import {createServer as createHttpServer} from 'http'
import {connect, createServer} from 'net'

import type {AddressInfo, Socket} from 'net'

import {connectThroughProxy} from '../../tunnel/proxy'

describe('connectThroughProxy', () => {
  const echoServer = createServer((socket) => socket.pipe(socket))
  const connectRequests: {authorization?: string; url?: string}[] = []
  const proxyServer = createHttpServer()
  proxyServer.on('connect', (request, clientSocket: Socket, head) => {
    connectRequests.push({authorization: request.headers['proxy-authorization'], url: request.url})
    if (request.url?.startsWith('blocked')) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')

      return
    }
    const [host, port] = (request.url ?? '').split(':')
    const upstream = connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
  })

  let echoPort: number
  let proxyPort: number

  beforeAll(async () => {
    await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
    echoPort = (echoServer.address() as AddressInfo).port
    proxyPort = (proxyServer.address() as AddressInfo).port
  })

  afterAll(() => {
    echoServer.close()
    proxyServer.close()
  })

  beforeEach(() => {
    connectRequests.length = 0
  })

  test('forwards raw TCP through the proxy with credentials', async () => {
    const socket = await connectThroughProxy(`http://user:p%40ss@127.0.0.1:${proxyPort}`, '127.0.0.1', echoPort, 1000)
    const echoed = new Promise<string>((resolve) => socket.once('data', (data) => resolve(data.toString())))
    socket.write('ping')

    expect(await echoed).toBe('ping')
    expect(connectRequests).toEqual([
      {authorization: `Basic ${Buffer.from('user:p@ss').toString('base64')}`, url: `127.0.0.1:${echoPort}`},
    ])
    socket.destroy()
  })

  test('rejects when the proxy refuses the CONNECT', async () => {
    await expect(connectThroughProxy(`http://127.0.0.1:${proxyPort}`, 'blocked', 80, 1000)).rejects.toThrow(
      'Proxy responded with status 403'
    )
  })

  test('rejects unsupported proxy protocols', async () => {
    await expect(connectThroughProxy('socks5://127.0.0.1:1080', '127.0.0.1', echoPort, 1000)).rejects.toThrow(
      'Unsupported proxy protocol for tunneled traffic: socks5:'
    )
  })
})
