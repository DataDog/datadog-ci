import retry from 'async-retry'
import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import {BufferedMetricsLogger} from 'datadog-metrics'
import FormData from 'form-data'
import {ReadStream} from 'fs'

import {ApiKeyValidator} from './apikey'
import {Logger, RequestBuilder} from './utils'

const errorCodesNoRetry = [400, 403, 413]

export interface MultipartPayload {
  content: Map<string, MultipartValue>
  renderFailedUpload(message: string): string
  renderRetry(errorMessage: string, attempt: number): string
  renderUpload(): string
}

export interface MultipartValue {
  options?: FormData.AppendOptions | string
  value: string | ReadStream
}

export interface APIHelper {
  uploadMultipart(sourcemap: MultipartPayload, write: Logger): AxiosPromise<AxiosResponse>
}

export interface UploadOptions {
  apiKeyValidator?: ApiKeyValidator,
  logger?: Logger,
  metricsLogger?: BufferedMetricsLogger,
  retries: number,
}

export enum UploadStatus {
  Success,
  Failure,
  Skipped,
}

export const upload = (requestBuilder: RequestBuilder, opts: UploadOptions) => async (payload: MultipartPayload): Promise<UploadStatus> => {

  const log = (s: string) => {
    if (opts.logger) {
      opts.logger(s)
    }
  }

  const incrementMetric = (key: string, value?: number, tags?: string[]) => {
    if (opts.metricsLogger) {
      opts.metricsLogger.increment(key, value, tags)
    }
  }

  const doUpload = async (bail: (e: Error) => void) => {
    try {
      await uploadMultipart(requestBuilder)(payload, log)
      incrementMetric('success', 1)

      return UploadStatus.Success
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

    return UploadStatus.Failure
  }
  try {
    return await retry(doUpload, {
      onRetry: (e, attempt) => {
        incrementMetric('retries', 1)
        log(payload.renderRetry(e.message, attempt))
      },
      retries: opts.retries,
    })
  } catch (error) {
    if (opts.apiKeyValidator) {
      opts.apiKeyValidator.verifyApiKey(error, incrementMetric)
    }
    incrementMetric('failed', 1)
    if (error.response && error.response.statusText) {
      // Display human readable info about the status code
      log(payload.renderFailedUpload(`${error.message} (${error.response.statusText})`))
    } else {
      // Default error handling
      log(payload.renderFailedUpload(error))
    }

    return UploadStatus.Failure
  }
}

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const uploadMultipart = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  payload: MultipartPayload,
  log: Logger
) => {
  const form = new FormData()

  log(payload.renderUpload())
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
