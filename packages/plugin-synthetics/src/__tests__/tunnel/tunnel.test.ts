import {once} from 'events'
import {createServer} from 'net'
import {PassThrough} from 'stream'

import type {AddressInfo, Server} from 'net'
import type {ClientChannel} from 'ssh2'

import {getProxyAgent} from '@datadog/datadog-ci-base/helpers/utils'
import {Client as SSHClient} from 'ssh2'

import {getTunnelReporter} from '../../reporters/default'
import {Tunnel} from '../../tunnel'
import {WebSocket} from '../../tunnel/websocket'
jest.mock('../../tunnel/websocket')

import {mockReporter} from '../fixtures'

describe('Tunnel', () => {
  const mockConnect = jest.fn()
  const mockClose = jest.fn()
  const mockTunnelReporter = getTunnelReporter(mockReporter)
  const mockWebSocket = {
    close: mockClose,
    connect: mockConnect,
    duplex: () => new PassThrough(),
    firstMessage: {host: 'host', id: 'tunnel-id'},
    keepAlive: async () =>
      new Promise(() => {
        // Never resolve
      }),
    waitForFirstMessage: async () => Promise.resolve(JSON.stringify(mockWebSocket.firstMessage)),
  }
  const testIDs = ['aaa-bbb-ccc']
  const wsPresignedURL = 'wss://tunnel.synthetics'

  const mockedWebSocket = jest.mocked(WebSocket)

  test('starts by connecting over WebSocket and closes the WebSocket when stopping', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)

    const tunnel = new Tunnel(wsPresignedURL, testIDs, undefined, mockTunnelReporter)
    const connectionInfo = await tunnel.start()
    expect(WebSocket).toHaveBeenCalledWith(wsPresignedURL, undefined)
    expect(mockConnect).toHaveBeenCalled()
    expect(connectionInfo.host).toEqual('host')
    expect(connectionInfo.id).toEqual('tunnel-id')
    expect(connectionInfo.privateKey.length).toBeGreaterThan(0)

    // TODO: test SSH authentication and processing

    // Stop the tunnel
    await tunnel.stop()
    expect(mockClose).toHaveBeenCalled()
  })

  test('throws an error if the WebSocket connection fails', async () => {
    mockedWebSocket.mockImplementation(
      () =>
        ({
          close: mockClose,
          connect: mockConnect,
        }) as any
    )

    const websocketConnectError = new Error('Error when connecting over WebSocket!')
    mockConnect.mockImplementation(() => {
      throw websocketConnectError
    })
    const tunnel = new Tunnel(wsPresignedURL, testIDs, undefined, mockTunnelReporter)
    await expect(tunnel.start()).rejects.toThrow(websocketConnectError)
    expect(mockClose).toHaveBeenCalled()
    mockConnect.mockRestore()
  })

  test('use provided proxy agent', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)
    const localProxyAgent = await getProxyAgent({
      host: '127.0.0.1',
      port: 8080,
      protocol: 'http',
    })
    const tunnel = new Tunnel(wsPresignedURL, testIDs, localProxyAgent, mockTunnelReporter)
    await tunnel.start()
    expect(WebSocket).toHaveBeenCalledWith(wsPresignedURL, localProxyAgent)

    // Stop the tunnel
    await tunnel.stop()
  })

  describe('forwarding', () => {
    let targetServer: Server
    let targetPort: number
    let targetConnections: number
    let tunnelServer: Server
    let tunnel: Tunnel
    let sshClient: SSHClient
    const tunnelReporter = {error: jest.fn(), log: jest.fn(), warn: jest.fn()}

    const openTunnel = async (allowedDomains?: string[]) => {
      mockedWebSocket.mockImplementation(() => mockWebSocket as any)
      tunnel = new Tunnel(wsPresignedURL, testIDs, undefined, tunnelReporter, allowedDomains)
      const {privateKey} = await tunnel.start()

      tunnelServer = createServer((socket) => void tunnel['processSSHStream'](socket))
      tunnelServer.listen(0, '127.0.0.1')
      await once(tunnelServer, 'listening')

      sshClient = new SSHClient()
      sshClient.connect({
        host: '127.0.0.1',
        port: (tunnelServer.address() as AddressInfo).port,
        privateKey,
        username: testIDs[0],
      })
      await once(sshClient, 'ready')
    }

    const forward = async (host: string) =>
      new Promise<ClientChannel>((resolve, reject) => {
        sshClient.forwardOut('127.0.0.1', 0, host, targetPort, (error, stream) =>
          error ? reject(error) : resolve(stream)
        )
      })

    const readFirstChunk = async (stream: ClientChannel) => {
      const [chunk] = (await once(stream, 'data')) as [Buffer]
      stream.destroy()

      return chunk.toString()
    }

    beforeEach(async () => {
      jest.clearAllMocks()
      targetConnections = 0
      targetServer = createServer((socket) => {
        targetConnections++
        socket.end('hello')
      })
      targetServer.listen(0)
      await once(targetServer, 'listening')
      targetPort = (targetServer.address() as AddressInfo).port
    })

    afterEach(async () => {
      sshClient.end()
      await tunnel.stop()
      tunnelServer.close()
      targetServer.close()
    })

    test('reaches any host when no allowed domains are configured', async () => {
      await openTunnel()

      expect(await readFirstChunk(await forward('127.0.0.1'))).toBe('hello')
      expect(targetConnections).toBe(1)
      expect(tunnelReporter.warn).toHaveBeenCalledWith(expect.stringContaining('Tunnel connections are not restricted'))
    })

    test('reaches a host listed in the allowed domains', async () => {
      await openTunnel(['localhost'])

      expect(await readFirstChunk(await forward('LOCALHOST'))).toBe('hello')
      expect(targetConnections).toBe(1)
    })

    test('blocks a reachable host missing from the allowed domains', async () => {
      await openTunnel(['localhost'])

      await expect(forward('127.0.0.1')).rejects.toThrow()

      expect(targetConnections).toBe(0)
      expect(tunnelReporter.warn).toHaveBeenCalledWith(
        'Blocked connection to "127.0.0.1": host is not in `tunnelAllowedDomains`'
      )
    })

    test('blocks a host that hides an internal address before a NUL byte', async () => {
      await openTunnel(['*.example.com'])

      await expect(forward('localhost\u0000.example.com')).rejects.toThrow()

      expect(targetConnections).toBe(0)
    })
  })
})
