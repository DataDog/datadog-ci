// tslint:disable: no-string-literal

import * as ciUtils from '../../../helpers/utils'

import {RunTestCommand} from '../cli'
import {ExecutionRule} from '../interfaces'
import * as runTests from '../run-test'

import {getSyntheticsProxy} from './fixtures'

describe('Proxy configuration', () => {
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
    const {config: proxyOpts, close: proxyClose, calls: proxyCalls} = getSyntheticsProxy()

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
      jest.spyOn(runTests, 'getDatadogHost').mockImplementation(() => 'http://datadoghq.com/')

      await command.execute()

      expect(proxyCalls.get).toHaveBeenCalled()
      expect(proxyCalls.presignedUrl).toHaveBeenCalled()
      expect(proxyCalls.tunnel).toHaveBeenCalled()
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
    } finally {
      await proxyClose()
    }
  })

  test('use proxy defined in environment variable', async () => {
    const {config: proxyOpts, close: proxyClose, calls: proxyCalls} = getSyntheticsProxy()
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
      jest.spyOn(runTests, 'getDatadogHost').mockImplementation(() => 'http://datadoghq.com/')

      await command.execute()

      expect(proxyCalls.get).toHaveBeenCalled()
      expect(proxyCalls.presignedUrl).toHaveBeenCalled()
      expect(proxyCalls.tunnel).toHaveBeenCalled()
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
    } finally {
      await proxyClose()
    }
  })
})
