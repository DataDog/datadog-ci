import FormData from 'form-data'
import fs from 'fs'

import {getRequestBuilder} from '../../helpers/utils'
import {APIHelper, Payload} from './interfaces'

export const apiConstructor = (baseUrl: string, apiKey: string, appKey: string): APIHelper => {
  const request = getRequestBuilder(baseUrl, apiKey, appKey)

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
