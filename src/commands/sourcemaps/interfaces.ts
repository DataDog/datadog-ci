import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

export interface Payload {
  cliVersion: string
  minifiedFilePath: string
  minifiedUrl: string
  overwrite?: boolean
  projectPath: string
  repositoryPayload?: string
  repositoryURL?: string
  commitSha?: string
  service: string
  sourcemapPath: string
  version: string
}

export interface APIHelper {
  uploadSourcemap(sourcemap: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
