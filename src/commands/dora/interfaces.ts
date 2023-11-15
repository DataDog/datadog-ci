import {AxiosPromise, AxiosResponse} from 'axios'

export interface DeploymentEvent {
  service: string
  env?: string
  startedAt: Date
  finishedAt: Date
  git?: GitInfo
}

export interface GitInfo {
  repoURL: string
  commitSHA: string
}

export interface APIHelper {
  sendDeploymentEvent(deployment: DeploymentEvent): AxiosPromise<AxiosResponse>
}
