import {stringify} from 'querystring'

import type {AxiosError, AxiosPromise, AxiosRequestConfig} from 'axios'

import {isAxiosError} from 'axios'

import {getRequestBuilder} from '../../helpers/utils'

import {CriticalError} from './errors'
import {
  APIConfiguration,
  APIHelperConfig,
  Batch,
  LocalTestDefinition,
  MobileAppUploadResult,
  MobileApplicationNewVersionParams,
  MobileApplicationUploadPart,
  MobileApplicationUploadPartResponse,
  MultipartPresignedUrlsResponse,
  Payload,
  PollResult,
  RawPollResultTest,
  RawPollResult,
  ServerBatch,
  ServerTest,
  SyntheticsOrgSettings,
  TestSearchResult,
  Trigger,
} from './interfaces'
import {MAX_TESTS_TO_TRIGGER} from './test'
import {ciTriggerApp, getDatadogHost, retry} from './utils/public'

const MAX_RETRIES = 3
const DELAY_BETWEEN_RETRIES = 500 // In ms
const LARGE_DELAY_BETWEEN_RETRIES = 1000 // In ms
// TODO SYNTH-13709: Use the `Retry-After` header.
const DELAY_BETWEEN_429_RETRIES = 5000 // In ms

interface BackendError {
  errors: string[]
}

export class EndpointError extends Error {
  constructor(public message: string, public status: number) {
    super(message)
    Object.setPrototypeOf(this, EndpointError.prototype)
  }
}

export const formatBackendErrors = (requestError: AxiosError<BackendError>, scopeName?: string) => {
  if (requestError.response?.data?.errors) {
    const serverHead = `query on ${requestError.config?.baseURL}${requestError.config?.url} returned:`
    const errors = requestError.response.data.errors
    const reportMessage = []
    if (errors.length > 1) {
      reportMessage.push(serverHead)
      reportMessage.push(...errors.map((message: string) => `  - ${message}`))
    } else if (errors.length) {
      reportMessage.push(`${serverHead} "${errors[0]}"`)
    } else {
      reportMessage.push(`error querying ${requestError.config?.baseURL}${requestError.config?.url}`)
    }

    if (requestError.response.status === 403 && scopeName) {
      reportMessage.push(`Is the App key granted the ${scopeName} scope?`)
    }

    return reportMessage.join('\n')
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
    request,
    {retryOn429: true}
  )

  return resp.data
}

const getTest = (request: (args: AxiosRequestConfig) => AxiosPromise<ServerTest>) => async (
  testId: string,
  testType?: string
) => {
  const resp = await retryRequest(
    {
      url: !!testType ? `/synthetics/tests/${testType}/${testId}` : `/synthetics/tests/${testId}`,
    },
    request,
    {retryOn429: true}
  )

  return resp.data
}

const getLocalTestDefinition = (request: (args: AxiosRequestConfig) => AxiosPromise<LocalTestDefinition>) => async (
  testId: string,
  testType?: string
) => {
  const resp = await retryRequest(
    {
      params: {
        format: 'ltd',
      },
      url: !!testType ? `/synthetics/tests/${testType}/${testId}` : `/synthetics/tests/${testId}`,
    },
    request,
    {retryOn429: true}
  )

  return resp.data
}

const editTest = (request: (args: AxiosRequestConfig) => AxiosPromise<Trigger>) => async (
  testId: string,
  data: ServerTest
) => {
  const resp = await retryRequest(
    {
      data,
      method: 'PUT',
      url: `/synthetics/tests/${testId}`,
    },
    request,
    {retryOn429: true}
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
  const resp = await retryRequest({url: `/synthetics/ci/batch/${batchId}`}, request, {
    retryOn404: true,
    retryOn429: true,
  })

  const serverBatch = resp.data.data

  return {
    results: serverBatch.results.filter((r) => r.status !== 'skipped' || r.selective_rerun) as Batch['results'],
    status: serverBatch.status,
  }
}

const pollResults = (request: (args: AxiosRequestConfig) => AxiosPromise<RawPollResult>) => async (
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
    {retryOn404: true, retryOn429: true}
  )

  const includedTestsByID = new Map<string, RawPollResultTest>()
  resp.data.included?.forEach((r) => {
    if (r.type === 'test') {
      const test = {
        id: r.id,
        ...r.attributes,
      }
      includedTestsByID.set(r.id, test)
    }
  })

  const rawPollResults = resp.data.data
  const parsedPollResults = []
  for (const r of rawPollResults) {
    const test = includedTestsByID.get(r.relationships.test.data.id)
    if (!test) {
      continue
    }
    const pollResult: PollResult = {
      ...r.attributes,
      test: parseIncludedTest(test),
    }

    parsedPollResults.push(pollResult)
  }

  return parsedPollResults
}

const parseIncludedTest = (test: RawPollResultTest): PollResult['test'] => {
  return {
    public_id: test.id,
    type: test.type,
    subtype: test.subtype,
    config: {
      ...test.config,
      request: {
        ...test.config.request,
        dnsServer: test.config.request.dns_server,
      },
    },
  }
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

    // Azure part-upload does not return ETag headers, so our backend ignores it for Azure
    const quotedEtag = isAzureUrl(presignedUrl) ? '' : (resp.headers.etag as string)

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
) => async (jobId: string): Promise<MobileAppUploadResult> => {
  const response = await retryRequest(
    {
      method: 'GET',
      url: `/synthetics/mobile/applications/validation-job-status/${jobId}`,
    },
    request
  )

  return response.data
}

const retryWithJitter = (delay: number = DELAY_BETWEEN_429_RETRIES) => delay + Math.floor(Math.random() * delay)

export type RetryPolicy = {
  retryOn404?: boolean | undefined
  retryOn429?: boolean | undefined
}

export const determineRetryDelay = (
  retries: number,
  error: Error,
  retryPolicy: RetryPolicy = {retryOn404: false, retryOn429: false}
) => {
  // Always retry on Node.js errors
  if (retries < MAX_RETRIES && isNodeError(error)) {
    return LARGE_DELAY_BETWEEN_RETRIES
  }

  // Always retry on 5xx
  if (retries < MAX_RETRIES && is5xxError(error)) {
    return DELAY_BETWEEN_RETRIES
  }

  // Retry on 404
  if (retryPolicy.retryOn404 && retries < MAX_RETRIES && isNotFoundError(error)) {
    return DELAY_BETWEEN_RETRIES
  }

  // Retry on 429
  if (retryPolicy.retryOn429 && retries < MAX_RETRIES && isTooManyRequestsError(error)) {
    return retryWithJitter(DELAY_BETWEEN_429_RETRIES)
  }
}

const isEndpointError = (error: Error): error is EndpointError => error instanceof EndpointError

export const getErrorHttpStatus = (error: Error): number | undefined =>
  isEndpointError(error) ? error.status : isAxiosError(error) ? error.response?.status : undefined

export const isForbiddenError = (error: Error): boolean => getErrorHttpStatus(error) === 403

export const isNotFoundError = (error: Error): boolean => getErrorHttpStatus(error) === 404

export const isTooManyRequestsError = (error: Error): boolean => getErrorHttpStatus(error) === 429

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => !!error && 'code' in (error as Error)

export const is5xxError = (error: Error): boolean => {
  const statusCode = getErrorHttpStatus(error)

  return statusCode && statusCode >= 500 && statusCode <= 599 ? true : false
}

const retryRequest = <T>(
  args: AxiosRequestConfig,
  request: (args: AxiosRequestConfig) => AxiosPromise<T>,
  statusCodesToRetryOn?: RetryPolicy
) =>
  retry(
    () => request(args),
    (retries, e) => determineRetryDelay(retries, e, statusCodesToRetryOn)
  )

export const apiConstructor = (configuration: APIConfiguration) => {
  const {baseV1Url, baseV2Url, baseIntakeUrl, baseUnstableUrl, apiKey, appKey, proxyOpts} = configuration
  const baseOptions = {apiKey, appKey, proxyOpts}
  const requestV1 = getRequestBuilder({...baseOptions, baseUrl: baseV1Url})
  const requestV2 = getRequestBuilder({...baseOptions, baseUrl: baseV2Url})
  const requestUnstable = getRequestBuilder({...baseOptions, baseUrl: baseUnstableUrl})
  const requestIntake = getRequestBuilder({...baseOptions, baseUrl: baseIntakeUrl})

  return {
    getBatch: getBatch(requestV1),
    getMobileApplicationPresignedURLs: getMobileApplicationPresignedURLs(requestUnstable),
    getTest: getTest(requestV1),
    getLocalTestDefinition: getLocalTestDefinition(requestV1),
    editTest: editTest(requestV1),
    getSyntheticsOrgSettings: getSyntheticsOrgSettings(requestV1),
    getTunnelPresignedURL: getTunnelPresignedURL(requestIntake),
    pollResults: pollResults(requestV2),
    searchTests: searchTests(requestV1),
    triggerTests: triggerTests(requestIntake),
    uploadMobileApplicationPart: uploadMobileApplicationPart(requestV1),
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
    baseV1Url: getDatadogHost({useIntake: false, apiVersion: 'v1', config}),
    baseV2Url: getDatadogHost({useIntake: false, apiVersion: 'v2', config}),
    proxyOpts: config.proxy,
  })
}

const isAzureUrl = (presignedUrl: string) => {
  // https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob-from-url?tabs=microsoft-entra-id#request
  return presignedUrl.includes('.blob.core.windows.net')
}
