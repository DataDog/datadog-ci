import retry from 'async-retry'

const errorCodesNoRetry = [400, 403, 413]

export const retryRequest = async (requestBuilder: () => Promise<any>, retryOpts: retry.Options): Promise<void> => {
  // Request function, passed to async-retry
  const doRequest = async (bail: (e: Error) => void) => {
    try {
      await requestBuilder()
    } catch (error) {
      if (error.response) {
        // If it's an axios error
        if (!errorCodesNoRetry.includes(error.response.status)) {
          // And a status code that is not excluded from retries, throw the error so that upload is retried
          throw error
        }
      } else {
        // If it's another error or an axios error let us retry just in case
        // This will catch DNS resolution errors and connection timeouts
        throw error
      }
      bail(error)
    }
  }

  // Do the actual call
  return retry(doRequest, retryOpts)
}
