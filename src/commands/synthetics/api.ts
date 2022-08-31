import {stringify} from 'querystring'

import axios, {AxiosError, AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {MAX_TESTS_TO_TRIGGER} from './command'
import {CriticalError} from './errors'
import {
  APIConfiguration,
  Batch,
  Payload,
  PollResult,
  ServerBatch,
  ServerTest,
  SyntheticsCIConfig,
  TestSearchResult,
  Trigger,
} from './interfaces'
import {ciTriggerApp, getDatadogHost, retry} from './utils'

const MAX_RETRIES = 3
const DELAY_BETWEEN_RETRIES = 500 // In ms

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
  if (requestError.response?.data?.errors) {
    const serverHead = `query on ${requestError.config.baseURL}${requestError.config.url} returned:`
    const errors = requestError.response.data.errors
    if (errors.length > 1) {
      const formattedErrors = errors.map((message: string) => `  - ${message}`)

      return `${serverHead}\n${formattedErrors.join('\n')}`
    } else if (errors.length) {
      return `${serverHead} "${errors[0]}"`
    } else {
      return `error querying ${requestError.config.baseURL} ${requestError.config.url}`
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

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<ServerTest>) => async (testId: string) => {
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
        // Search for one more test than limit to detect if too many tests are returned
        count: MAX_TESTS_TO_TRIGGER + 1,
        text: query,
      },
      url: '/synthetics/tests/search',
    },
    request
  )

  return resp.data
}

const getBatch = (request: (args: AxiosRequestConfig) => AxiosPromise<{data: ServerBatch}>) => async (
  batchId: string
): Promise<Batch> => {
  const resp = await retryRequest({url: `/synthetics/ci/batch/${batchId}`}, request, retryOn5xxOr404Errors)

  const serverBatch = resp.data.data

  return {
    results: serverBatch.results.filter((r) => r.status !== 'skipped') as Batch['results'],
    status: serverBatch.status,
  }
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
    request,
    retryOn5xxOr404Errors
  )

  return resp.data.results
}

const getTunnelPresignedURL = (request: (args: AxiosRequestConfig) => AxiosPromise<{url: string}>) => async (
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

const getMobileApplicationPresignedURL = (request: (args: AxiosRequestConfig) => AxiosPromise<{presigned_url_params: string; file_name: string}>) => async (
  applicationId: string,
  md5: string
) => {
  const resp = await retryRequest(
    {
      method: 'POST',
      params: {
        md5,
      },
      paramsSerializer: (params) => stringify(params),
      url: `/synthetics/mobile/applications/${applicationId}/presigned-url`,
    },
    request
  )

  return resp.data
}

const uploadMobileApplication = (request: (args: AxiosRequestConfig) => AxiosPromise<void>) => async (
  fileBuffer: Buffer,
  presignedUrl: string
) => {
  await retryRequest(
    {
      method: 'POST',
      data: fileBuffer,
      url: presignedUrl,
    },
    request
  )
}

type RetryPolicy = (retries: number, error: AxiosError) => number | undefined

const retryOn5xxErrors: RetryPolicy = (retries, error) => {
  if (retries < MAX_RETRIES && is5xxError(error)) {
    return DELAY_BETWEEN_RETRIES
  }
}

const retryOn5xxOr404Errors: RetryPolicy = (retries, error) => {
  const retryOn5xxDelay = retryOn5xxErrors(retries, error)
  if (retryOn5xxDelay) {
    return retryOn5xxDelay
  }

  if (retries < MAX_RETRIES && isNotFoundError(error)) {
    return DELAY_BETWEEN_RETRIES
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

const retryRequest = <T>(
  args: AxiosRequestConfig,
  request: (args: AxiosRequestConfig) => AxiosPromise<T>,
  retryPolicy: RetryPolicy = retryOn5xxErrors
) => retry(() => request(args), retryPolicy)

export const apiConstructor = (configuration: APIConfiguration) => {
  const {baseUrl, baseIntakeUrl, apiKey, appKey, proxyOpts} = configuration
  const baseOptions = {apiKey, appKey, proxyOpts}
  const request = getRequestBuilder({...baseOptions, baseUrl})
  const requestIntake = getRequestBuilder({...baseOptions, baseUrl: baseIntakeUrl})

  return {
    getBatch: getBatch(request),
    getMobileApplicationPresignedURL: getMobileApplicationPresignedURL(request),
    getTest: getTest(request),
    getTunnelPresignedURL: getTunnelPresignedURL(requestIntake),
    pollResults: pollResults(request),
    searchTests: searchTests(request),
    triggerTests: triggerTests(requestIntake),
    uploadMobileApplication: uploadMobileApplication(request)
  }
}

export type APIHelper = ReturnType<typeof apiConstructor>

export const getApiHelper = (config: SyntheticsCIConfig): APIHelper => {
  if (!config.appKey) {
    throw new CriticalError('MISSING_APP_KEY')
  }
  if (!config.apiKey) {
    throw new CriticalError('MISSING_API_KEY')
  }

  return apiConstructor({
    apiKey: config.apiKey!,
    appKey: config.appKey!,
    baseIntakeUrl: getDatadogHost(true, config),
    baseUrl: getDatadogHost(false, config),
    proxyOpts: config.proxy,
  })
}
