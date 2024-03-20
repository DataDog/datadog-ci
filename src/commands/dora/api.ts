import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getDatadogSite} from '../../helpers/api'
import {getRequestBuilder} from '../../helpers/utils'

import {DeploymentEvent} from './interfaces'

export const sendDeploymentEvent = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  deployment: DeploymentEvent
) => {
  const attrs: Record<string, any> = {
    service: deployment.service,
    started_at: deployment.startedAt.getTime() * 1e6, // ms to ns
    finished_at: deployment.finishedAt.getTime() * 1e6, // ms to ns
  }
  if (deployment.env) {
    attrs.env = deployment.env
  }
  if (deployment.git) {
    attrs.git = {
      repository_url: deployment.git.repoURL,
      commit_sha: deployment.git.commitSHA,
    }
  }

  return request({
    method: 'POST',
    url: 'api/v2/dora/deployment',
    data: {
      data: {
        attributes: attrs,
      },
    },
  })
}

export const apiConstructor = (apiKey: string) => {
  const requestAPI = getRequestBuilder({baseUrl: `https://api.${getDatadogSite()}`, apiKey})

  return {
    sendDeploymentEvent: sendDeploymentEvent(requestAPI),
  }
}
