import {AxiosPromise, AxiosResponse} from 'axios'

export interface Payload {
  dependenciesFilePath: string
  service: string
  version: string
}

export interface APIHelper {
  uploadDependencies(payload: Payload): AxiosPromise<AxiosResponse>
}
