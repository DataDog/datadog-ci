import {EnvHttpProxyAgent} from 'undici'

import {newApiKeyValidator} from '../apikey'
import * as request from '../request'

describe('newApiKeyValidator', () => {
  describe('validateApiKey', () => {
    test('uses the environment proxy dispatcher', async () => {
      const httpRequestSpy = jest.spyOn(request, 'httpRequest').mockResolvedValue({
        config: {},
        data: {valid: true},
        headers: {},
        status: 200,
        statusText: 'OK',
      })

      const validator = newApiKeyValidator({
        apiKey: 'api-key',
        datadogSite: 'datadoghq.com',
      })

      await expect(validator.validateApiKey()).resolves.toBe(true)

      expect(httpRequestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.datadoghq.com',
          dispatcher: expect.any(EnvHttpProxyAgent),
        })
      )

      httpRequestSpy.mockRestore()
    })

    test('returns false for a 403 response', async () => {
      jest.spyOn(request, 'httpRequest').mockRejectedValue(
        Object.assign(
          new request.RequestError('Forbidden', {}, {data: undefined, status: 403, statusText: 'Forbidden'}),
          {
            isRequestError: true,
          }
        )
      )

      const validator = newApiKeyValidator({apiKey: 'api-key', datadogSite: 'datadoghq.com'})
      await expect(validator.validateApiKey()).resolves.toBe(false)

      jest.restoreAllMocks()
    })

    test('rethrows non-403 errors (e.g. network/proxy failure)', async () => {
      const networkError = new request.RequestError('read ECONNRESET', {})
      jest.spyOn(request, 'httpRequest').mockRejectedValue(networkError)

      const validator = newApiKeyValidator({apiKey: 'api-key', datadogSite: 'datadoghq.com'})
      await expect(validator.validateApiKey()).rejects.toThrow('read ECONNRESET')

      jest.restoreAllMocks()
    })

    test('returns false for an empty API key', async () => {
      const validator = newApiKeyValidator({apiKey: '', datadogSite: 'datadoghq.com'})
      await expect(validator.validateApiKey()).resolves.toBe(false)
    })
  })
})
