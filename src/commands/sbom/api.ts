import {Writable} from 'stream'

import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {SBOMPayload} from './pb/sbom_intake'
import {renderUpload} from './renderer'

// Dependency follows-redirects sets a default maxBodyLength of 10 MB https://github.com/follow-redirects/follow-redirects/blob/b774a77e582b97174813b3eaeb86931becba69db/index.js#L391
// We don't want any hard limit enforced by the CLI, the backend will enforce a max size by returning 413 errors.
const maxBodyLength = Infinity

export const uploadSBomPayload = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  payload: SBOMPayload,
  write: Writable['write']
) => {
  write(renderUpload())

  const buffer = SBOMPayload.encode(payload).finish().buffer

  return request({
    data: buffer,
    headers: {
      'Content-Type': 'application/x-protobuf',
      'DD-EVP-ORIGIN': 'datadog-ci',
      'DD-EVP-ORIGIN-VERSION': '0.0.1',
    },
    maxBodyLength,
    method: 'POST',
    url: 'api/v2/sbom',
  })
}

export const apiConstructor = (baseIntakeUrl: string, apiKey: string) => {
  const requestIntake = getRequestBuilder({baseUrl: baseIntakeUrl, apiKey})

  return {
    uploadSBomPayload: uploadSBomPayload(requestIntake),
  }
}
