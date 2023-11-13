import {AxiosPromise, AxiosResponse} from 'axios'

export interface DeploymentEvent {
  service: string
}

export interface APIHelper {
  sendDeploymentEvent(deployment: DeploymentEvent): AxiosPromise<AxiosResponse>
}
