// tslint:disable: no-string-literal

import {PassThrough} from 'stream'

import {mocked} from 'ts-jest/utils'

import * as ciUtils from '../../../helpers/utils'

import {ExecutionRule} from '../interfaces'
import {RunTestCommand} from '../run-test'
import {Tunnel} from '../tunnel'
import {WebSocket} from '../websocket'

import {getSyntheticsProxy, mockReporter} from './fixtures'

jest.mock('../websocket')

describe('Tunnel', () => {
  const mockConnect = jest.fn()
  const mockClose = jest.fn()
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

  const defaultProxyOpts: ciUtils.ProxyConfiguration = {protocol: 'http'}
  const testIDs = ['aaa-bbb-ccc']
  const wsPresignedURL = 'wss://tunnel.synthetics'

  const mockedWebSocket = mocked(WebSocket, true)

  test('starts by connecting over WebSocket and closes the WebSocket when stopping', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)

    const tunnel = new Tunnel(wsPresignedURL, testIDs, defaultProxyOpts, mockReporter)
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
    const tunnel = new Tunnel(wsPresignedURL, testIDs, defaultProxyOpts, mockReporter)
    await expect(tunnel.start()).rejects.toThrow(websocketConnectError)
    expect(mockClose).toBeCalled()
    mockConnect.mockRestore()
  })

  test('sets websocket proxy options', async () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)
    const localProxyOpts: ciUtils.ProxyConfiguration = {
      host: '127.0.0.1',
      port: 8080,
      protocol: 'http',
    }
    const tunnel = new Tunnel(wsPresignedURL, testIDs, localProxyOpts, mockReporter)
    await tunnel.start()
    expect(WebSocket).toHaveBeenCalledWith(wsPresignedURL, localProxyOpts)

    // Stop the tunnel
    await tunnel.stop()
  })

  describe('proxy configuration', () => {
    mockedWebSocket.mockImplementation(() => mockWebSocket as any)
    let initialHttpProxyEnv: string | undefined

    beforeAll(() => {
      initialHttpProxyEnv = process.env.HTTP_PROXY
    })

    afterAll(() => {
      if (initialHttpProxyEnv !== undefined) {
        process.env.HTTP_PROXY = initialHttpProxyEnv
      } else {
        delete process.env.HTTP_PROXY
      }
    })

    beforeEach(() => {
      delete process.env.HTTP_PROXY
    })

    test('use proxy defined in configuration', async () => {
      const {server: proxy, config: proxyOpts, calls: proxyCalls} = getSyntheticsProxy()

      try {
        jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({
          apiKey: '123',
          appKey: '123',
          proxy: proxyOpts,
          publicIds: ['123-456-789'],
          tunnel: true,
        }))

        const command = new RunTestCommand()
        command.context = {stdout: {write: jest.fn()}} as any
        command['getDatadogHost'] = () => 'http://datadoghq.com/'

        await command.execute()

        expect(proxyCalls.get).toHaveBeenCalled()
        expect(proxyCalls.presignedUrl).toHaveBeenCalled()
        expect(proxyCalls.trigger).toHaveBeenCalledWith(
          expect.objectContaining({
            tests: [
              {
                executionRule: ExecutionRule.BLOCKING,
                public_id: '123-456-789',
                tunnel: expect.objectContaining({host: 'host', id: 'tunnel-id', privateKey: expect.any(String)}),
              },
            ],
          })
        )

        expect(mockedWebSocket).toHaveBeenCalledWith('wss://tunnel.synthetics', proxyOpts)
      } finally {
        await new Promise((res) => proxy.close(res))
      }
    })

    test('use proxy defined in environment variable', async () => {
      const {server: proxy, config: proxyOpts, calls: proxyCalls} = getSyntheticsProxy()
      process.env.HTTP_PROXY = `http://127.0.0.1:${proxyOpts.port}`

      try {
        jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({
          apiKey: '123',
          appKey: '123',
          publicIds: ['123-456-789'],
          tunnel: true,
        }))

        const command = new RunTestCommand()
        command.context = {stdout: {write: jest.fn()}} as any
        command['getDatadogHost'] = () => 'http://datadoghq.com/'

        await command.execute()

        expect(proxyCalls.get).toHaveBeenCalled()
        expect(proxyCalls.presignedUrl).toHaveBeenCalled()
        expect(proxyCalls.trigger).toHaveBeenCalledWith(
          expect.objectContaining({
            tests: [
              {
                executionRule: ExecutionRule.BLOCKING,
                public_id: '123-456-789',
                tunnel: expect.objectContaining({host: 'host', id: 'tunnel-id', privateKey: expect.any(String)}),
              },
            ],
          })
        )

        expect(mockedWebSocket).toHaveBeenCalledWith('wss://tunnel.synthetics', proxyOpts)
      } finally {
        await new Promise((res) => proxy.close(res))
      }
    })
  })
})
