import {AxiosError, AxiosPromise, AxiosRequestConfig, default as axios} from 'axios'
import FormData from 'form-data'
import fs from 'fs'

import {APIConfiguration, Payload} from './interfaces'

interface BackendError {
  errors: string[]
}

export const uploadSourcemap = (request: (args: AxiosRequestConfig) => AxiosPromise<void>) => async (sourcemap: Payload) => {
  const form = new FormData()
  form.append('service', sourcemap.service)
  form.append('version', sourcemap.version)
  form.append('minified_url', sourcemap.minifiedUrl)
  form.append('sourcemap', fs.createReadStream(sourcemap.sourcemapPath))
  form.append('minified_file', fs.createReadStream(sourcemap.minifiedFilePath))

  const resp = await request({
    data: form,
    method: 'POST',
    url: 'v1/input',
  })

  return resp.data
}

export const apiConstructor = ({apiKey, baseIntakeUrl}: APIConfiguration) => {
  const overrideArgs = (args: AxiosRequestConfig) => {
    const newArguments = {
      ...args,
      params: {
        api_key: apiKey,
        ...args.params,
      },
    }

    return newArguments
  }

  const request = (args: AxiosRequestConfig) => axios.create({baseURL: baseIntakeUrl})(overrideArgs(args))

  return {
    uploadSourcemap: uploadSourcemap(request),
  }
}
