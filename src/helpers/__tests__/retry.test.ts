import type {AxiosPromise, AxiosResponseHeaders, InternalAxiosRequestConfig} from 'axios'

import {retryRequest} from '../retry'

describe('retry', () => {
  const retryCallback = jest.fn()
  const createResultWithErrors = (errors: any[]): (() => AxiosPromise) => {
    let i = -1

    return () => {
      i = i + 1
      if (errors[i] === undefined) {
        return Promise.resolve({
          config: {} as InternalAxiosRequestConfig,
          data: {},
          headers: {} as AxiosResponseHeaders,
          status: 200,
          statusText: '',
        })
      }

      return Promise.reject(errors[i])
    }
  }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  const buildHttpError = (statusCode: number) => ({
    response: {
      status: statusCode,
    },
  })

  test('should retry retriable failed requests', async () => {
    await retryRequest(createResultWithErrors([buildHttpError(500), undefined]), {
      maxTimeout: 50,
      minTimeout: 10,
      onRetry: retryCallback,
      retries: 5,
    })
    expect(retryCallback).toHaveBeenCalledTimes(1)
  })

  test('should retry non-http errors', async () => {
    await retryRequest(createResultWithErrors([{message: 'Connection timeout'}, undefined]), {
      maxTimeout: 50,
      minTimeout: 10,
      onRetry: retryCallback,
      retries: 5,
    })
    expect(retryCallback).toHaveBeenCalledTimes(1)
  })

  test('should not retry some clients failures', async () => {
    let threwError = false
    try {
      await retryRequest(createResultWithErrors([buildHttpError(413)]), {
        maxTimeout: 50,
        minTimeout: 10,
        onRetry: retryCallback,
        retries: 5,
      })
    } catch (error) {
      threwError = true
    }
    expect(threwError).toBeTruthy()
    expect(retryCallback).toHaveBeenCalledTimes(0)
  })

  test('should retry only a given amount of times', async () => {
    let threwError = false
    try {
      await retryRequest(
        createResultWithErrors([buildHttpError(500), buildHttpError(500), buildHttpError(500), buildHttpError(500)]),
        {
          maxTimeout: 20,
          minTimeout: 10,
          onRetry: retryCallback,
          retries: 3,
        }
      )
    } catch (error) {
      threwError = true
    }
    expect(threwError).toBeTruthy()
    expect(retryCallback).toHaveBeenCalledTimes(3)
  })

  test('should not retry if the call was successful', async () => {
    await retryRequest(createResultWithErrors([undefined]), {
      maxTimeout: 50,
      minTimeout: 10,
      onRetry: retryCallback,
      retries: 5,
    })
    expect(retryCallback).toHaveBeenCalledTimes(0)
  })
})
