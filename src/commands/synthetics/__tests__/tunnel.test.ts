import {PassThrough} from 'stream'

import {mocked} from 'ts-jest/utils'

import {Tunnel} from '../tunnel'
import {WebSocketWithReconnect} from '../websocket'

jest.mock('../websocket')

describe('Tunnel', () => {
  const duplex = new PassThrough()
  const mockConnect = jest.fn()
  const mockClose = jest.fn()

  const noLog = () => true
  const testIDs = ['aaa-bbb-ccc']
  const wsPresignedURL = 'wss://tunnel.synthetics'

  const mockedWebSocketWithReconnect = mocked(WebSocketWithReconnect, true)

  it('starts by connecting over WebSocket and closes the WebSocket when stopping', async () => {
    mockedWebSocketWithReconnect.mockImplementation(
      () =>
        ({
          addEventListener: (event: 'message', handler: (message: string) => void) => {
            const tunnelInfo = {host: 'host', id: 'tunnel-id'}
            handler(JSON.stringify(tunnelInfo))
          },
          close: mockClose,
          connect: mockConnect,
          duplex: () => duplex,
        } as any)
    ) // Casting to any to avoid re-defining all methods

    const tunnel = new Tunnel(wsPresignedURL, testIDs, noLog)
    const connectionInfo = await tunnel.start()
    expect(WebSocketWithReconnect).toHaveBeenCalledWith(
      wsPresignedURL,
      expect.any(Function),
      expect.any(Number),
      expect.any(Number)
    )
    expect(mockConnect).toHaveBeenCalled()
    expect(connectionInfo.host).toEqual('host')
    expect(connectionInfo.id).toEqual('tunnel-id')
    expect(connectionInfo.privateKey.length).toBeGreaterThan(0)

    // TODO: test SSH authentication and processing

    // Stop the tunnel
    await tunnel.stop()
    expect(mockClose).toHaveBeenCalled()
  })

  it('throws an error if the WebSocket connection fails', async () => {
    mockedWebSocketWithReconnect.mockImplementation(
      () =>
        ({
          close: mockClose,
          connect: mockConnect,
        } as any)
    ) // Casting to any to avoid re-defining all methods

    const websocketConnectError = new Error('Error when connecting over WebSocket!')
    mockConnect.mockImplementation(() => {
      throw websocketConnectError
    })
    const tunnel = new Tunnel(wsPresignedURL, testIDs, noLog)
    await expect(tunnel.start()).rejects.toThrow(websocketConnectError)
    expect(mockClose).toBeCalled()
  })
})
