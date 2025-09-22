import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '@datadog/datadog-ci-base/helpers/utils'

import {DeploymentEvent} from './interfaces'

export const datadogSite = process.env.DD_SITE || 'datadoghq.com'
export const apiUrl = `https://api.${datadogSite}`

export const sendDeploymentEvent =
  (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (deployment: DeploymentEvent) => {
    const attrs: Record<string, any> = {
      service: deployment.service,
      started_at: deployment.startedAt.getTime() * 1e6, // ms to ns
      finished_at: deployment.finishedAt.getTime() * 1e6, // ms to ns
    }
    if (deployment.env) {
      attrs.env = deployment.env
    }
    if (deployment.version) {
      attrs.version = deployment.version
    }
    if (deployment.git) {
      attrs.git = {
        repository_url: deployment.git.repoURL,
        commit_sha: deployment.git.commitSHA,
      }
    }
    if (deployment.team) {
      attrs.team = deployment.team
    }
    if (deployment.customTags) {
      attrs.custom_tags = deployment.customTags
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
  const requestAPI = getRequestBuilder({baseUrl: apiUrl, apiKey})

  return {
    sendDeploymentEvent: sendDeploymentEvent(requestAPI),
  }
}
