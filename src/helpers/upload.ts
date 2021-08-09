import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import {Writable} from 'stream'

import {getRequestBuilder} from './utils'

export interface MultipartPayload {
  content: Map<string, MultipartValue>
  renderUpload(): string
}

export interface MultipartValue {
  options?: FormData.AppendOptions | string
  value: any
}

export const newMultipartValue = (value: any, options?: FormData.AppendOptions | string) => ({
  options,
  value,
})

export interface APIHelper {
  uploadMultipart(sourcemap: MultipartPayload, write: Writable['write']): AxiosPromise<AxiosResponse>
}

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

const uploadMultipart = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  payload: MultipartPayload,
  write: Writable['write']
) => {
  const form = new FormData()

  write(payload.renderUpload())
  payload.content.forEach((value: any, key: string) => {
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

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const request = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadMultipart: uploadMultipart(request),
  }
}
