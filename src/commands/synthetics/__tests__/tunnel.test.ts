import {PassThrough} from 'stream'

import {mocked} from 'ts-jest/utils'

import {ProxyConfiguration} from '../../../helpers/utils'
import {Tunnel} from '../tunnel'
import {WebSocket} from '../websocket'

jest.mock('../websocket')

describe('Tunnel', () => {
  const mockConnect = jest.fn()
  const mockClose = jest.fn()
  const mockWebSocket = {
    close: mockClose,
    connect: mockConnect,
    duplex: () => new PassThrough(),
    waitForFirstMessage: () => {
      const tunnelInfo = {host: 'host', id: 'tunnel-id'}

      return JSON.stringify(tunnelInfo)
    },
  }

  const defaultProxyOpts: ProxyConfiguration = {protocol: 'http'}
  const noLog = () => true
  const testIDs = ['aaa-bbb-ccc']
  const wsPresignedURL = 'wss://tunnel.synthetics'

  const mockedWebSocket = mocked(WebSocket, true)

  test('starts by connecting over WebSocket and closes the WebSocket when stopping', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)

    const tunnel = new Tunnel(wsPresignedURL, testIDs, defaultProxyOpts, noLog)
    const connectionInfo = await tunnel.start()
    expect(WebSocket).toHaveBeenCalledWith(wsPresignedURL, expect.any(Object))
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
    const tunnel = new Tunnel(wsPresignedURL, testIDs, defaultProxyOpts, noLog)
    await expect(tunnel.start()).rejects.toThrow(websocketConnectError)
    expect(mockClose).toBeCalled()
    mockConnect.mockRestore()
  })

  test('sets websocket proxy options', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)
    const localProxyOpts: ProxyConfiguration = {
      host: '127.0.0.1',
      port: 8080,
      protocol: 'http',
    }
    const tunnel = new Tunnel(wsPresignedURL, testIDs, localProxyOpts, noLog)
    await tunnel.start()
    expect(WebSocket).toHaveBeenCalledWith(wsPresignedURL, localProxyOpts)

    // Stop the tunnel
    await tunnel.stop()
  })
})
