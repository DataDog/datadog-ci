import {AxiosError, AxiosPromise, AxiosRequestConfig, default as axios} from 'axios'
import ProxyAgent from 'proxy-agent'
import FormData from 'form-data'
import fs from 'fs'

import {Payload} from './interfaces'

interface BackendError {
  errors: string[]
}

const uploadSourcemap = (request: (args: AxiosRequestConfig) => AxiosPromise<void>) => async (sourcemap: Payload) => {
  let form = new FormData()
  form.append("service", sourcemap.service)
  form.append("version", sourcemap.version)
  form.append("minified_url", sourcemap.minifiedUrl)
  form.append("sourcemap", fs.createReadStream(sourcemap.sourcemapPath))
  form.append("minified_file", fs.createReadStream(sourcemap.minifiedFilePath))

  const resp = await request({
    data: form,
    method: 'POST',
    url: 'v1/input',
  })

  return resp.data
}
