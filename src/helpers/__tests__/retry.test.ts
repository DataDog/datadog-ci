import {AxiosPromise} from 'axios'
import {retryRequest} from '../retry'

describe('retry', () => {
  const retryCallback = jest.fn()
  const createResultWithErrors = (errors: any[]): (() => AxiosPromise) => {
    let i = -1

    return () => {
      i = i + 1
      if (errors[i] === undefined) {
        return Promise.resolve({
          config: {},
          data: {},
          headers: undefined,
          status: 200,
          statusText: '',
        })
      } else {
        return Promise.reject(errors[i])
      }
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
      onRetry: retryCallback,
      retries: 5,
    })
    expect(retryCallback).toBeCalledTimes(1)
  })

  test('should retry non-http errors', async () => {
    await retryRequest(createResultWithErrors([{message: 'Connection timeout'}, undefined]), {
      onRetry: retryCallback,
      retries: 5,
    })
    expect(retryCallback).toBeCalledTimes(1)
  })

  test('should not retry some clients failures', async () => {
    let threwError = false
    try {
      await retryRequest(createResultWithErrors([buildHttpError(413)]), {
        onRetry: retryCallback,
        retries: 5,
      })
    } catch (error) {
      threwError = true
    }
    expect(threwError).toBeTruthy()
    expect(retryCallback).toBeCalledTimes(0)
  })

  test('should retry only a given amount of times', async () => {
    let threwError = false
    try {
      await retryRequest(createResultWithErrors([buildHttpError(413), buildHttpError(413)]), {
        onRetry: retryCallback,
        retries: 1,
      })
    } catch (error) {
      threwError = true
    }
    expect(threwError).toBeTruthy()
    expect(retryCallback).toBeCalledTimes(0)
  })

  test('should not retry if the call was successful', async () => {
    await retryRequest(createResultWithErrors([undefined]), {
      onRetry: retryCallback,
      retries: 1,
    })
    expect(retryCallback).toBeCalledTimes(0)
  })
})
