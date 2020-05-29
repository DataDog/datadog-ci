import {AxiosPromise, AxiosResponse} from 'axios'

export interface Payload {
  minifiedFilePath: string
  minifiedUrl: string
  overwrite?: boolean
  project_path?: string
  service: string
  sourcemapPath: string
  version: string
}

export interface APIConfiguration {
  apiKey: string
  baseIntakeUrl: string
}

export interface APIHelper {
  uploadSourcemap(sourcemap: Payload): AxiosPromise<AxiosResponse>
}
