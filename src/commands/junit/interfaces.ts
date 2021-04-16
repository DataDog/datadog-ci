import {AxiosPromise, AxiosResponse} from 'axios'
import {Writable} from 'stream'

export interface Payload {
  service: string
  xmlPath: string
}

export interface APIHelper {
  uploadJUnitXML(sourcemap: Payload, write: Writable['write']): AxiosPromise<AxiosResponse>
}
