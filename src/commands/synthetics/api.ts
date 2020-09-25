import {AxiosError, AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {APIConfiguration, Payload, PollResult, Test, TestSearchResult, Trigger} from './interfaces'

interface BackendError {
  errors: string[]
}

export const formatBackendErrors = (requestError: AxiosError<BackendError>) => {
  if (requestError.response && requestError.response.data.errors) {
    const errors = requestError.response.data.errors.map((message: string) => `  - ${message}`)
    const serverHead = `query on ${requestError.config.baseURL}${requestError.config.url} returned:`

    return `${serverHead}\n${errors.join('\n')}`
  }

  return requestError.message
}

const triggerTests = (request: (args: AxiosRequestConfig) => AxiosPromise<Trigger>) => async (tests: Payload[]) => {
  const resp = await request({
    data: {tests},
    method: 'POST',
    url: '/synthetics/tests/trigger/ci',
  })

  return resp.data
}

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<Test>) => async (testId: string) => {
  const resp = await request({
    url: `/synthetics/tests/${testId}`,
  })

  return resp.data
}

const searchTests = (request: (args: AxiosRequestConfig) => AxiosPromise<TestSearchResult>) => async (
  query: string
) => {
  const resp = await request({
    params: {
      text: query,
    },
    url: '/synthetics/tests/search',
  })

  return resp.data
}

const pollResults = (request: (args: AxiosRequestConfig) => AxiosPromise<{results: PollResult[]}>) => async (
  resultIds: string[]
) => {
  const resp = await request({
    params: {
      result_ids: JSON.stringify(resultIds),
    },
    url: '/synthetics/tests/poll_results',
  })

  return resp.data
}

export const apiConstructor = (configuration: APIConfiguration) => {
  const {baseUrl, baseIntakeUrl, apiKey, appKey, proxyOpts} = configuration
  const request = getRequestBuilder(baseUrl, apiKey, appKey, proxyOpts)
  const requestIntake = getRequestBuilder(baseIntakeUrl, apiKey, appKey, proxyOpts)

  return {
    getTest: getTest(request),
    pollResults: pollResults(request),
    searchTests: searchTests(request),
    triggerTests: triggerTests(requestIntake),
  }
}
