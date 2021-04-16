import {AxiosPromise, AxiosResponse} from 'axios'

export interface Payload {
  service: string
  xmlPath: string
}

export interface APIHelper {
  uploadJUnitXML(sourcemap: Payload): AxiosPromise<AxiosResponse>
}
