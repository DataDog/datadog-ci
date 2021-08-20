import retry from 'async-retry'
import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import {ReadStream} from 'fs'

import {ApiKeyValidator} from './apikey'
import {RequestBuilder} from './interfaces'

const errorCodesNoRetry = [400, 403, 413]

/** Multipart payload destined to be sent to Datadog's API
 */
export interface MultipartPayload {
  content: Map<string, MultipartValue>
}

export interface MultipartValue {
  options?: FormData.AppendOptions | string
  value: string | ReadStream
}

export interface UploadOptions {
  /** ApiKeyValidator (optional) throws an InvalidConfigurationException when upload fails because
   * of an invalid API key. Callers should most likely catch this exception and display it as a
   * nice error message.
   */
  apiKeyValidator?: ApiKeyValidator

  /** Retries is the amount of upload retries before giving up. Some requests are never retried
   * (400, 413).
   */
  retries: number

  /** Callback when upload fails (retries are not considered as failure)
   */
  onError(error: Error): void

  /** Callback to execute before retries
   */
  onRetry(error: Error, attempts: number): void

  /** Callback to execute before upload.
   */
  onUpload(): void
}

export enum UploadStatus {
  Success,
  Failure,
  Skipped,
}

/** Upload a MultipartPayload to Datadog's API using the provided RequestBuilder.
 * This handles retries as well as logging information about upload if a logger is provided in
 * the options
 */
export const upload = (requestBuilder: RequestBuilder) => async (
  payload: MultipartPayload,
  opts: UploadOptions
): Promise<UploadStatus> => {
  opts.onUpload()
  try {
    await uploadWithRetry(requestBuilder, {
      onRetry: opts.onRetry,
      retries: opts.retries,
    })(payload)

    return UploadStatus.Success
  } catch (error) {
    if (opts.apiKeyValidator) {
      // Raise an exception in case of invalid API key
      await opts.apiKeyValidator.verifyApiKey(error)
    }
    if (error.response && error.response.statusText) {
      // Rewrite error to have formatted error string
      opts.onError(new Error(`${error.message} (${error.response.statusText})`))
    } else {
      // Default error handling
      opts.onError(error)
    }

    return UploadStatus.Failure
  }
}

const uploadWithRetry = (requestBuilder: RequestBuilder, retryOpts: retry.Options) => async (
  payload: MultipartPayload
): Promise<void> => {
  // Upload function, passed to async-retry
  const doUpload = async (bail: (e: Error) => void) => {
    try {
      await uploadMultipart(requestBuilder)(payload)
    } catch (error) {
      if (error.response) {
        // If it's an axios error
        if (!errorCodesNoRetry.includes(error.response.status)) {
          // And a status code that is not excluded from retries, throw the error so that upload is retried
          throw error
        }
      }
      // If it's another error or an axios error we don't want to retry, bail
      bail(error)
    }
  }

  // Do the actual call
  return retry(doUpload, retryOpts)
}

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const uploadMultipart = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  payload: MultipartPayload
) => {
  const form = new FormData()
  payload.content.forEach((value: MultipartValue, key: string) => {
    form.append(key, value.value, value.options)
  })

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}
