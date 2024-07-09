import {createCommand} from '../../../../helpers/__tests__/fixtures'
import * as ciUtils from '../../../../helpers/utils'

import {RunTestsCommand} from '../../run-tests-command'
import * as utils from '../../utils/public'

import {getSyntheticsProxy} from '../fixtures'

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
      // Here it is dangerous to create a config file since it would create a link between
      // the proxy port in the getSyntheticsProxy file and the config file.
      // Instead we mock the util function that is called in the command.
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async (config) => ({
        ...(config as Record<string, unknown>),
        apiKey: '123',
        appKey: '123',
        proxy: proxyOpts,
        publicIds: ['123-456-789'],
        tunnel: true,
      }))

      const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
      jest.spyOn(utils, 'getDatadogHost').mockImplementation(() => 'http://datadoghq.com/')

      await command.execute()

      expect(proxyCalls.get).toHaveBeenCalled()
      expect(proxyCalls.presignedUrl).toHaveBeenCalled()
      expect(proxyCalls.tunnel).toHaveBeenCalled()
      expect(proxyCalls.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          tests: [
            {
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
      const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-tunnel-no-proxy.json'
      jest.spyOn(utils, 'getDatadogHost').mockImplementation(() => 'http://datadoghq.com/')

      await command.execute()

      expect(proxyCalls.get).toHaveBeenCalled()
      expect(proxyCalls.presignedUrl).toHaveBeenCalled()
      expect(proxyCalls.tunnel).toHaveBeenCalled()
      expect(proxyCalls.trigger).toHaveBeenCalledWith(
        expect.objectContaining({
          tests: [
            {
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
