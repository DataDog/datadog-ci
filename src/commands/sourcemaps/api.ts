import {AxiosPromise, AxiosRequestConfig, AxiosResponse, default as axios} from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import {Writable} from 'stream'

import {APIConfiguration, Payload} from './interfaces'
import {renderUpload} from './renderer'

export const uploadSourcemap = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  sourcemap: Payload,
  write: Writable['write']
) => {
  const form = new FormData()
  write(renderUpload(sourcemap.sourcemapPath))
  form.append('service', sourcemap.service)
  form.append('version', sourcemap.version)
  form.append('source_map', fs.createReadStream(sourcemap.sourcemapPath))
  form.append('minified_file', fs.createReadStream(sourcemap.minifiedFilePath))
  form.append('minified_url', sourcemap.minifiedUrl)
  form.append('project_path', sourcemap.projectPath)

  return request({
    data: form,
    headers: form.getHeaders(),
    method: 'POST',
    url: 'v1/input',
  })
}

export const apiConstructor = ({apiKey, baseIntakeUrl}: APIConfiguration) => {
  const overrideArgs = (args: AxiosRequestConfig) => ({
    ...args,
    headers: {
      'DD-API-KEY': apiKey,
      ...args.headers,
    },
  })

  const request = (args: AxiosRequestConfig) =>
    axios.create({
      baseURL: baseIntakeUrl,
    })(overrideArgs(args))

  return {
    uploadSourcemap: uploadSourcemap(request),
  }
}
