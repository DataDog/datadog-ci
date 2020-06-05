import {AxiosPromise, AxiosRequestConfig, AxiosResponse, default as axios} from 'axios'
import FormData from 'form-data'
import fs from 'fs'

import {APIConfiguration, Payload} from './interfaces'

const maxPayloadLength = 50 * 1024 * 1024 // 50 MB

export const uploadSourcemap = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  sourcemap: Payload
) => {
  const form = new FormData()
  console.log(`Uploading sourcemap ${sourcemap.sourcemapPath}`)
  form.append('service', sourcemap.service)
  form.append('version', sourcemap.version)
  form.append('source_map', fs.createReadStream(sourcemap.sourcemapPath))
  form.append('minified_file', fs.createReadStream(sourcemap.minifiedFilePath))
  form.append('minified_url', sourcemap.minifiedUrl)
  form.append('project_path', sourcemap.projectPath)

  return request({
    data: form,
    headers: form.getHeaders(),
    maxContentLength: maxPayloadLength,
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
