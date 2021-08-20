import {AxiosPromise, AxiosRequestConfig, AxiosResponse, default as axios} from 'axios'

import {ApiKeyValidator} from '../apikey'
import {upload, UploadStatus} from '../upload'
import * as ciUtils from '../utils'

describe('upload', () => {
  describe('upload', () => {
    const errorCallback = jest.fn()
    const retryCallback = jest.fn()
    const uploadCallback = jest.fn()
    const verifyKey = jest.fn()
    const mockAxiosResponse = (responses: (() => Promise<any>)[]) => {
      let mock = jest.spyOn(axios, 'create')
      responses.forEach((response) => {
        mock = mock.mockImplementationOnce((() => response) as any)
      })
      mock.mockImplementation((() => () => undefined) as any)

      return mock
    }

    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should upload successfully a multipart payload', async () => {
      const mockCreate = mockAxiosResponse([() => Promise.resolve({})])

      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})

      const result = await upload(request)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockCreate).toBeCalledTimes(1)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(0)
      expect(retryCallback).toBeCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    test('should retry retriable failed requests', async () => {
      const mockCreate = mockAxiosResponse([
        () =>
          Promise.reject({
            response: {
              status: 500,
            },
          }),
        () => Promise.resolve({}),
      ])

      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})

      const result = await upload(request)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockCreate).toBeCalledTimes(2)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(0)
      expect(retryCallback).toBeCalledTimes(1)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    test('should not retry some clients failures', async () => {
      const mockCreate = mockAxiosResponse([
        () =>
          Promise.reject({
            response: {
              status: 413,
            },
          }),
      ])

      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})

      const result = await upload(request)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockCreate).toBeCalledTimes(1)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(1)
      expect(retryCallback).toBeCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Failure)
    })

    test('should retry only a given amount of times', async () => {
      const mockCreate = mockAxiosResponse([
        () =>
          Promise.reject({
            response: {
              status: 413,
            },
          }),
        () =>
          Promise.reject({
            response: {
              status: 413,
            },
          }),
      ])

      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})

      const result = await upload(request)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      expect(mockCreate).toBeCalledTimes(1)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(1)
      expect(retryCallback).toBeCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Failure)
    })

    test('apiKeyValidator should not be called in case of success', async () => {
      const mockCreate = mockAxiosResponse([() => Promise.resolve({})])
      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})
      verifyKey.mockImplementation(() => Promise.resolve())
      const result = await upload(request)(
        {content: new Map()},
        {
          apiKeyValidator: {
            verifyApiKey: verifyKey,
          },
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      expect(mockCreate).toBeCalledTimes(1)
      expect(verifyKey).toBeCalledTimes(0)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(0)
      expect(retryCallback).toBeCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    test('apiKeyValidator should be called in case of ambiguous response', async () => {
      const mockCreate = mockAxiosResponse([
        () =>
          Promise.reject({
            response: {
              status: 400,
            },
          }),
      ])
      const request = ciUtils.getRequestBuilder({apiKey: '', baseUrl: ''})
      verifyKey.mockImplementation(() => Promise.reject('errorApiKey'))
      const result = upload(request)(
        {content: new Map()},
        {
          apiKeyValidator: {
            verifyApiKey: verifyKey,
          },
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      expect(result).rejects.toMatch('errorApiKey')
      expect(mockCreate).toBeCalledTimes(1)
      expect(uploadCallback).toBeCalledTimes(1)
      expect(errorCallback).toBeCalledTimes(0)
      expect(retryCallback).toBeCalledTimes(0)
    })
  })
})
