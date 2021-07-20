import {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import {Writable} from 'stream'

import {buildPath, getRequestBuilder} from '../../helpers/utils'

import {Payload} from './interfaces'
import {renderUpload} from './renderer'
import {zip} from './utils'

const maxBodyLength = Infinity

export const uploadDSYM = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  dSYM: Payload,
  write: Writable['write']
) => {
  const form = new FormData()
  write(renderUpload(dSYM))
  form.append('type', dSYM.type)
  const concatUUIDs = dSYM.uuids.join()
  form.append('uuids', concatUUIDs)

  const tmpFilePath = buildPath('/tmp', 'datadog-ci', 'dsyms', `${concatUUIDs}.zip`)
  await zip(dSYM.path, tmpFilePath)
  form.append('symbols_archive', fs.createReadStream(tmpFilePath))

  return request({
    data: form,
    headers: form.getHeaders(),
    maxBodyLength,
    method: 'POST',
    url: 'v1/input',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadDSYM: uploadDSYM(requestIntake),
  }
}
