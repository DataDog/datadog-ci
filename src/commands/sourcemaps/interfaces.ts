import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

export interface Payload {
  minifiedFilePath: string
  minifiedUrl: string
  overwrite?: boolean
  projectPath: string
  service: string
  sourcemapPath: string
  version: string
  gitInfos?: string
}

export interface APIHelper {
  uploadSourcemap(sourcemap: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
