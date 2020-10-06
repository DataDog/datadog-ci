import FormData from 'form-data'
import fs from 'fs'

import {getRequestBuilder} from '../../helpers/utils'
import {APIHelper, Payload} from './interfaces'

export const apiConstructor = (baseUrl: string, apiKey: string, appKey: string): APIHelper => {
  const request = getRequestBuilder(baseUrl, apiKey, appKey)

  function uploadDependencies(payload: Payload) {
    const form = new FormData()

    form.append('service', payload.service)
    form.append('version', payload.version)
    form.append('dependencies_file', fs.readFileSync(payload.dependenciesFilePath))

    return request({
      data: form,
      headers: form.getHeaders(),
      method: 'POST',
      url: '/profiling/api/v1/depgraph',
    })
  }

  return {
    uploadDependencies,
  }
}
