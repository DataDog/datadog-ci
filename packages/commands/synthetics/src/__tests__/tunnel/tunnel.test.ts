import {PassThrough} from 'stream'

import {getProxyAgent} from '@datadog/datadog-ci-core/helpers/utils'

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
        } as any)
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
    const localProxyAgent = getProxyAgent({
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
})
