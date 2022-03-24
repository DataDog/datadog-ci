import {stringify} from 'querystring'

import {AxiosError, AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {APIConfiguration, APIHelper, Payload, PollResult, Test, TestSearchResult, Trigger} from './interfaces'
import {ciTriggerApp, retry} from './utils'

interface BackendError {
  errors: string[]
}

export class EndpointError extends Error {
  constructor(public message: string, public status: number) {
    super(message)
    Object.setPrototypeOf(this, EndpointError.prototype)
  }
}

export const formatBackendErrors = (requestError: AxiosError<BackendError>) => {
  if (requestError.response && requestError.response.data.errors) {
    const serverHead = `query on ${requestError.config.baseURL}${requestError.config.url} returned:`
    const errors = requestError.response.data.errors
    if (errors.length > 1) {
      const formattedErrors = errors.map((message: string) => `  - ${message}`)

      return `${serverHead}\n${formattedErrors.join('\n')}`
    } else if (errors.length) {
      return `${serverHead} "${errors[0]}"`
    } else {
      return `error querying ${requestError.config.baseURL}${requestError.config.url}`
    }
  }

  return requestError.message
}

const triggerTests = (request: (args: AxiosRequestConfig) => AxiosPromise<Trigger>) => async (data: Payload) => {
  const resp = await retryRequest(
    {
      data,
      headers: {'X-Trigger-App': ciTriggerApp},
      method: 'POST',
      url: '/synthetics/tests/trigger/ci',
    },
    request
  )

  return resp.data
}

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<Test>) => async (testId: string) => {
  const resp = await retryRequest(
    {
      url: `/synthetics/tests/${testId}`,
    },
    request
  )

  return resp.data
}

const searchTests = (request: (args: AxiosRequestConfig) => AxiosPromise<TestSearchResult>) => async (
  query: string
) => {
  const resp = await retryRequest(
    {
      params: {
        text: query,
      },
      url: '/synthetics/tests/search',
    },
    request
  )

  return resp.data
}

const pollResults = (request: (args: AxiosRequestConfig) => AxiosPromise<{results: PollResult[]}>) => async (
  resultIds: string[]
) => {
  const resp = await retryRequest(
    {
      params: {
        result_ids: JSON.stringify(resultIds),
      },
      url: '/synthetics/tests/poll_results',
    },
    request
  )

  return resp.data
}

const getPresignedURL = (request: (args: AxiosRequestConfig) => AxiosPromise<{url: string}>) => async (
  testIds: string[]
) => {
  const resp = await retryRequest(
    {
      params: {
        test_id: testIds,
      },
      paramsSerializer: (params) => stringify(params),
      url: '/synthetics/ci/tunnel',
    },
    request
  )

  return resp.data
}

const retryOn5xxErrors = (retries: number, error: AxiosError) => {
  if (retries < 3 && is5xxError(error)) {
    return 500
  }
}

const getErrorHttpStatus = (error: AxiosError | EndpointError) =>
  'status' in error ? error.status : error.response?.status

export const isForbiddenError = (error: AxiosError | EndpointError) => getErrorHttpStatus(error) === 403

export const isNotFoundError = (error: AxiosError | EndpointError) => getErrorHttpStatus(error) === 404

export const is5xxError = (error: AxiosError | EndpointError) => {
  const statusCode = getErrorHttpStatus(error)

  return statusCode && statusCode >= 500 && statusCode <= 599
}

const retryRequest = <T>(args: AxiosRequestConfig, request: (args: AxiosRequestConfig) => AxiosPromise<T>) =>
  retry(() => request(args), retryOn5xxErrors)

export const apiConstructor = (configuration: APIConfiguration): APIHelper => {
  const {baseUrl, baseIntakeUrl, apiKey, appKey, proxyOpts} = configuration
  const baseOptions = {apiKey, appKey, proxyOpts}
  const request = getRequestBuilder({...baseOptions, baseUrl})
  const requestIntake = getRequestBuilder({...baseOptions, baseUrl: baseIntakeUrl})

  return {
    getPresignedURL: getPresignedURL(requestIntake),
    getTest: getTest(request),
    pollResults: pollResults(request),
    searchTests: searchTests(request),
    triggerTests: triggerTests(requestIntake),
  }
}
