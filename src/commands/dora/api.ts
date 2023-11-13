import type {AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {DeploymentEvent} from './interfaces'

export const datadogSite = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
export const apiUrl = `https://api.${datadogSite}`

export const sendDeploymentEvent = (request: (args: AxiosRequestConfig) => AxiosPromise<AxiosResponse>) => async (
  deployment: DeploymentEvent
) => {
  return request({
    method: 'POST',
    url: 'api/v2/dora/deployment',
    data: deployment,
  })
}

export const apiConstructor = (apiKey: string) => {
  const requestAPI = getRequestBuilder({baseUrl: apiUrl, apiKey})

  return {
    sendDeploymentEvent: sendDeploymentEvent(requestAPI),
  }
}
