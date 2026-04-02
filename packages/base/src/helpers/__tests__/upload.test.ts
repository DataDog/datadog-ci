import type {RequestResponse} from '../request'
import type {Readable} from 'stream'

import {upload, UploadStatus} from '../upload'

describe('upload', () => {
  describe('upload', () => {
    const errorCallback = jest.fn()
    const retryCallback = jest.fn()
    const uploadCallback = jest.fn()
    const verifyKey = jest.fn()

    const makeRequestBuilder = (responses: (() => Promise<RequestResponse>)[]) => {
      let i = 0

      return jest.fn().mockImplementation(() => {
        const response = responses[i]
        i++

        return response ? response() : Promise.resolve({data: {}, status: 200, statusText: '', headers: {}, config: {}})
      })
    }

    beforeEach(() => {
      jest.clearAllMocks()
    })

    test('should upload successfully a multipart payload', async () => {
      const mockRequest = makeRequestBuilder([
        () => Promise.resolve({data: {}, status: 200, statusText: '', headers: {}, config: {}}),
      ])

      const result = await upload(mockRequest)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(0)
      expect(retryCallback).toHaveBeenCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    test('should retry retriable failed requests', async () => {
      const mockRequest = makeRequestBuilder([
        () =>
          Promise.reject({
            response: {
              status: 500,
            },
          }),
        () => Promise.resolve({data: {}, status: 200, statusText: '', headers: {}, config: {}}),
      ])

      const result = await upload(mockRequest)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(0)
      expect(retryCallback).toHaveBeenCalledTimes(1)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    it('should send the files content on each retry', async () => {
      let firstRequestBody = ''
      let secondRequestBody = ''

      const mockRequest = jest
        .fn()
        .mockImplementationOnce(async (config: any) => {
          firstRequestBody = await readStream(config.data)

          return Promise.reject({response: {status: 500}})
        })
        .mockImplementationOnce(async (config: any) => {
          secondRequestBody = await readStream(config.data)

          return {data: {}, status: 200, statusText: '', headers: {}, config: {}}
        })

      await upload(mockRequest)(
        {
          content: new Map([['file', {type: 'file', path: `${__dirname}/upload-fixtures/file.txt`, options: {}}]]),
        },
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )

      expect(firstRequestBody).toContain('some data to upload')
      expect(secondRequestBody).toContain('some data to upload')
    })

    test('should not retry some clients failures', async () => {
      const mockRequest = makeRequestBuilder([
        () =>
          Promise.reject({
            response: {
              status: 413,
            },
          }),
      ])

      const result = await upload(mockRequest)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 5,
        }
      )
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(1)
      expect(retryCallback).toHaveBeenCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Failure)
    })

    test('should retry only a given amount of times', async () => {
      const mockRequest = makeRequestBuilder([
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

      const result = await upload(mockRequest)(
        {content: new Map()},
        {
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(1)
      expect(retryCallback).toHaveBeenCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Failure)
    })

    test('apiKeyValidator should not be called in case of success', async () => {
      const mockRequest = makeRequestBuilder([
        () => Promise.resolve({data: {}, status: 200, statusText: '', headers: {}, config: {}}),
      ])
      verifyKey.mockImplementation(() => Promise.resolve())
      const result = await upload(mockRequest)(
        {content: new Map()},
        {
          apiKeyValidator: {
            verifyApiKey: verifyKey,
            validateApiKey: jest.fn(),
          },
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(verifyKey).toHaveBeenCalledTimes(0)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(0)
      expect(retryCallback).toHaveBeenCalledTimes(0)
      expect(result).toStrictEqual(UploadStatus.Success)
    })

    test('apiKeyValidator should be called in case of ambiguous response', async () => {
      const mockRequest = makeRequestBuilder([
        () =>
          Promise.reject({
            response: {
              status: 400,
            },
          }),
      ])
      verifyKey.mockImplementation(() => Promise.reject('errorApiKey'))
      const result = upload(mockRequest)(
        {content: new Map()},
        {
          apiKeyValidator: {
            verifyApiKey: verifyKey,
            validateApiKey: jest.fn(),
          },
          onError: errorCallback,
          onRetry: retryCallback,
          onUpload: uploadCallback,
          retries: 1,
        }
      )
      await expect(result).rejects.toMatch('errorApiKey')
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(uploadCallback).toHaveBeenCalledTimes(1)
      expect(errorCallback).toHaveBeenCalledTimes(0)
      expect(retryCallback).toHaveBeenCalledTimes(0)
    })
  })
})

const readStream = (stream: Readable) => {
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = []
    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
    })
    stream.on('end', () => {
      resolve(chunks.join(''))
    })
    stream.on('error', reject)
    stream.resume()
  })
}
