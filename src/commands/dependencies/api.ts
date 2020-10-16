import {AxiosRequestConfig, default as axios} from 'axios'
import FormData from 'form-data'
import fs from 'fs'

import {APIHelper, Payload} from './interfaces'

export const apiConstructor = (baseIntakeUrl: string, apiKey: string, appKey: string): APIHelper => {
  const overrideArgs = (args: AxiosRequestConfig) => ({
    ...args,
    headers: {
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      ...args.headers,
    },
  })

  const request = (args: AxiosRequestConfig) =>
    axios.create({
      baseURL: baseIntakeUrl,
    })(overrideArgs(args))

  function uploadDependencies(payload: Payload) {
    const form = new FormData()

    form.append('source', payload.source)
    form.append('file', fs.createReadStream(payload.dependenciesFilePath))
    form.append('service', payload.service)
    if (payload.version) {
      form.append('version', payload.version)
    }

    return request({
      data: form,
      headers: form.getHeaders(),
      method: 'POST',
      url: '/profiling/api/v1/dep-graphs',
    })
  }

  return {
    uploadDependencies,
  }
}
