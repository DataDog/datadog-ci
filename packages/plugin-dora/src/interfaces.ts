import type {RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

export interface DeploymentEvent {
  service: string
  env?: string
  startedAt: Date
  finishedAt: Date
  git?: GitInfo
  version?: string
  team?: string
  customTags?: string[]
}

export interface GitInfo {
  repoURL: string
  commitSHA: string
}

export interface APIHelper {
  sendDeploymentEvent(deployment: DeploymentEvent): Promise<RequestResponse>
}
