import {Writable} from 'stream'

import {AxiosPromise, AxiosResponse} from 'axios'

import {SBOMPayload} from './pb/sbom_intake'

export interface SBomFileObject {
  filePath: string
  content: any | undefined
  err: string | undefined
}

export interface APIHelper {
  uploadSBomPayload(payload: SBOMPayload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
