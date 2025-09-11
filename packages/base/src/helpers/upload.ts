import fs from 'fs'
import {createGzip} from 'zlib'

import FormData from 'form-data'

import {ApiKeyValidator} from './apikey'
import {RequestBuilder} from './interfaces'
import {retryRequest} from './retry'

/** Multipart payload destined to be sent to Datadog's API
 */
export interface MultipartPayload {
  content: Map<string, MultipartValue>
}

export type MultipartValue = MultipartStringValue | MultipartFileValue

export interface MultipartStringValue {
  type: 'string'
  value: string
  options: FormData.AppendOptions
}

export interface MultipartFileValue {
  type: 'file'
  path: string
  options: FormData.AppendOptions
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

  /** Whether to gzip the request */
  useGzip?: boolean

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
export const upload =
  (requestBuilder: RequestBuilder) =>
  async (payload: MultipartPayload, opts: UploadOptions): Promise<UploadStatus> => {
    opts.onUpload()
    try {
      await retryRequest(() => uploadMultipart(requestBuilder, payload, opts.useGzip ?? false), {
        onRetry: opts.onRetry,
        retries: opts.retries,
      })

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

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const uploadMultipart = async (request: RequestBuilder, payload: MultipartPayload, useGzip: boolean) => {
  const form = new FormData()
  payload.content.forEach((value: MultipartValue, key: string) => {
    switch (value.type) {
      case 'string':
        form.append(key, value.value, value.options)
        break
      case 'file':
        form.append(key, fs.createReadStream(value.path), value.options)
        break
    }
  })

  let data: any = form
  let headers = form.getHeaders()
  if (useGzip) {
    const gz = createGzip()
    data = data.pipe(gz)
    headers = {
      'Content-Encoding': 'gzip',
      ...headers,
    }
  }

  return request({
    data,
    headers,
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}
