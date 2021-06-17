import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

export interface Payload {
  cliVersion: string
  gitCommitSha: string
  gitRepositoryPayload: string
  gitRepositoryURL: string
}

export interface APIHelper {
  uploadRepository(repository: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
