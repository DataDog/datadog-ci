import {stringify} from 'querystring'

import type {AxiosError, AxiosPromise, AxiosRequestConfig} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {CriticalError} from './errors'
import {
  APIConfiguration,
  APIHelperConfig,
  Batch,
  MobileApplicationUploadPart,
  MobileApplicationUploadPartResponse,
  Payload,
  PollResult,
  MultipartPresignedUrlsResponse,
  ServerBatch,
  ServerTest,
  SyntheticsOrgSettings,
  TestSearchResult,
  Trigger,
  MobileAppUploadResult,
  MobileApplicationNewVersionParams,
} from './interfaces'
import {MAX_TESTS_TO_TRIGGER} from './run-tests-command'
import {ciTriggerApp, getDatadogHost, retry} from './utils/public'

const MAX_RETRIES = 3
const DELAY_BETWEEN_RETRIES = 500 // In ms
const LARGE_DELAY_BETWEEN_RETRIES = 1000 // In ms

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
    const serverHead = `query on ${requestError.config?.baseURL}${requestError.config?.url} returned:`
    const errors = requestError.response.data.errors
    if (errors.length > 1) {
      const formattedErrors = errors.map((message: string) => `  - ${message}`)

      return `${serverHead}\n${formattedErrors.join('\n')}`
    } else if (errors.length) {
      return `${serverHead} "${errors[0]}"`
    } else {
      return `error querying ${requestError.config?.baseURL}${requestError.config?.url}`
    }
  }

  return `could not query ${requestError.config?.baseURL}${requestError.config?.url}\n${requestError.message}`
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

const getSyntheticsOrgSettings = (
  request: (args: AxiosRequestConfig) => AxiosPromise<SyntheticsOrgSettings>
) => async () => {
  const resp = await retryRequest(
    {
      url: '/synthetics/settings',
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
    results: serverBatch.results.filter((r) => r.status !== 'skipped' || r.selective_rerun) as Batch['results'],
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

const getMobileApplicationPresignedURLs = (
  request: (args: AxiosRequestConfig) => AxiosPromise<MultipartPresignedUrlsResponse>
) => async (
  applicationId: string,
  appSize: number,
  parts: MobileApplicationUploadPart[]
): Promise<MultipartPresignedUrlsResponse> => {
  const partForRequest = (part: MobileApplicationUploadPart) => ({
    md5: part.md5,
    partNumber: part.partNumber,
  })

  const resp = await retryRequest(
    {
      data: {
        appSize,
        parts: parts.map(partForRequest),
      },
      method: 'POST',
      url: `/synthetics/mobile/applications/${applicationId}/multipart-presigned-urls`,
    },
    request
  )

  return resp.data
}

const uploadMobileApplicationPart = (request: (args: AxiosRequestConfig) => AxiosPromise<void>) => async (
  parts: MobileApplicationUploadPart[],
  multipartPresignedUrlsParams: MultipartPresignedUrlsResponse['multipart_presigned_urls_params']
): Promise<MobileApplicationUploadPartResponse[]> => {
  const promises = Object.entries(multipartPresignedUrlsParams.urls).map(async ([partNumber, presignedUrl]) => {
    const resp = await retryRequest(
      {
        data: parts[Number(partNumber) - 1].blob,
        headers: {
          'Content-MD5': parts[Number(partNumber) - 1].md5,
          // Presigned URL *requires* unset content-type since it's used for signature
          // We can clear axios default by setting to null
          // https://github.com/axios/axios/pull/1845
          // eslint-disable-next-line no-null/no-null
          'Content-Type': null,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        method: 'PUT',
        url: presignedUrl,
      },
      request
    )

    const quotedEtag = resp.headers.etag as string

    return {
      ETag: quotedEtag.replace(/"/g, ''),
      PartNumber: Number(partNumber),
    }
  })

  return Promise.all(promises)
}

export const completeMultipartMobileApplicationUpload = (
  request: (args: AxiosRequestConfig) => AxiosPromise<{job_id: string}>
) => async (
  applicationId: string,
  uploadId: string,
  key: string,
  uploadPartResponses: MobileApplicationUploadPartResponse[],
  newVersionParams?: MobileApplicationNewVersionParams
): Promise<string> => {
  const resp = await retryRequest(
    {
      data: {
        key,
        newVersionParams,
        parts: uploadPartResponses,
        uploadId,
        validateMode: newVersionParams ? 'validate-and-persist' : 'validate-only',
      },
      method: 'POST',
      url: `/synthetics/mobile/applications/${applicationId}/multipart-upload-complete`,
    },
    request
  )

  return resp.data.job_id
}

export const pollMobileApplicationUploadResponse = (
  request: (args: AxiosRequestConfig) => AxiosPromise<MobileAppUploadResult>
) => async (
  jobId: string
): Promise<MobileAppUploadResult> => {
  const response = await retryRequest(
    {
      method: 'GET',
      url: `/synthetics/mobile/applications/validation-job-status/${jobId}`,
    },
    request
  )

  return response.data
}

type RetryPolicy = (retries: number, error: AxiosError) => number | undefined

const retryOn5xxErrors: RetryPolicy = (retries, error) => {
  // Retry on Node.js errors for both retry policies.
  if (retries < MAX_RETRIES && isNodeError(error)) {
    return LARGE_DELAY_BETWEEN_RETRIES
  }

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

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => !!error && 'code' in (error as Error)

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
  const {baseUrl, baseIntakeUrl, baseUnstableUrl, apiKey, appKey, proxyOpts} = configuration
  const baseOptions = {apiKey, appKey, proxyOpts}
  const request = getRequestBuilder({...baseOptions, baseUrl})
  const requestUnstable = getRequestBuilder({...baseOptions, baseUrl: baseUnstableUrl})
  const requestIntake = getRequestBuilder({...baseOptions, baseUrl: baseIntakeUrl})

  return {
    getBatch: getBatch(request),
    getMobileApplicationPresignedURLs: getMobileApplicationPresignedURLs(requestUnstable),
    getTest: getTest(request),
    getSyntheticsOrgSettings: getSyntheticsOrgSettings(request),
    getTunnelPresignedURL: getTunnelPresignedURL(requestIntake),
    pollResults: pollResults(request),
    searchTests: searchTests(request),
    triggerTests: triggerTests(requestIntake),
    uploadMobileApplicationPart: uploadMobileApplicationPart(request),
    completeMultipartMobileApplicationUpload: completeMultipartMobileApplicationUpload(requestUnstable),
    pollMobileApplicationUploadResponse: pollMobileApplicationUploadResponse(requestUnstable),
  }
}

export type APIHelper = ReturnType<typeof apiConstructor>

export const getApiHelper = (config: APIHelperConfig): APIHelper => {
  if (!config.appKey) {
    throw new CriticalError('MISSING_APP_KEY', 'App key is required')
  }
  if (!config.apiKey) {
    throw new CriticalError('MISSING_API_KEY', 'API key is required')
  }

  return apiConstructor({
    apiKey: config.apiKey,
    appKey: config.appKey,
    baseIntakeUrl: getDatadogHost({useIntake: true, apiVersion: 'v1', config}),
    baseUnstableUrl: getDatadogHost({useIntake: false, apiVersion: 'unstable', config}),
    baseUrl: getDatadogHost({useIntake: false, apiVersion: 'v1', config}),
    proxyOpts: config.proxy,
  })
}
