import retry from 'async-retry'

const errorCodesNoRetry = [400, 403, 413]

export const retryRequest = async (requestPerformer: () => Promise<any>, retryOpts: retry.Options): Promise<void> => {
  // Request function, passed to async-retry
  const doRequest = async (bail: (e: Error) => void) => {
    try {
      await requestPerformer()
    } catch (error) {
      if (error.response && errorCodesNoRetry.includes(error.response.status)) {
        // If it's an axios error with a status code that is excluded from retries, we bail to avoid retrying
        bail(error)

        return
      }
      // Other cases are retried: other axios HTTP errors as well as
      // non-axios errors such as DNS resolution errors and connection timeouts
      throw error
    }
  }

  // Do the actual call
  return retry(doRequest, retryOpts)
}
