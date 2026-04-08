import retry from 'async-retry'

const errorCodesNoRetry = [400, 403, 413]

export const retryRequest = async <T>(
  requestPerformer: (bail?: (e: Error) => void, attempt?: number) => Promise<T>,
  retryOpts: retry.Options
): Promise<T> => {
  // Request function, passed to async-retry
  const doRequest = async (bail: (e: Error) => void, attempt: number) => {
    try {
      return await requestPerformer(bail, attempt)
    } catch (error) {
      if (error.response && errorCodesNoRetry.includes(error.response.status)) {
        // If it's an HTTP error with a status code that is excluded from retries, we bail to avoid retrying
        bail(error)

        // bail interrupt the flow by throwing an exception, the code below is not executed
        return {} as T
      }
      // Other cases are retried: other HTTP errors as well as
      // non-HTTP errors such as DNS resolution errors and connection timeouts
      throw error
    }
  }

  // Do the actual call
  return retry(doRequest, retryOpts)
}
