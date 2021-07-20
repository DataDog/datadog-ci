import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

export interface Payload {
  path: string
  type: string
  uuids: string[]
}

export interface APIHelper {
  uploadDSYM(dSYM: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}

export enum UploadStatus {
  Success,
  Failure,
  Skipped,
}
