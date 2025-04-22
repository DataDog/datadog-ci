import {createServer} from 'http'
import {AddressInfo} from 'net'

import type {AxiosResponse} from 'axios'

import axios, {AxiosError} from 'axios'

import {getAxiosError} from '../../../helpers/__tests__/fixtures'

import {apiConstructor, formatBackendErrors, getApiHelper} from '../api'
import {RecursivePartial} from '../base-command'
import {CriticalError} from '../errors'
import {ExecutionRule, PollResult, RawPollResult, ServerResult, Test, TestPayload, Trigger} from '../interfaces'
import {MAX_TESTS_TO_TRIGGER} from '../test'
import * as internalUtils from '../utils/internal'

import {
  ciConfig,
  getApiTest,
  getSyntheticsProxy,
  MOBILE_PRESIGNED_URLS_PAYLOAD,
  MOBILE_PRESIGNED_UPLOAD_PARTS,
  mockSearchResponse,
  mockTestTriggerResponse,
  APP_UPLOAD_POLL_RESULTS,
  getMockApiConfiguration,
} from './fixtures'

describe('dd-api', () => {
  const apiConfiguration = getMockApiConfiguration()
  const LOCATION = {
    display_name: 'fake location',
    id: 42,
    is_active: true,
    name: 'fake-loc',
    region: 'fake-region',
  }
  const RESULT_ID = '123'
  const BATCH_ID = 'bid'
  const API_TEST = getApiTest('abc-def-ghi')
  const POLL_RESULTS: PollResult[] = [
    {
      test_type: 'api',
      test: API_TEST as RecursivePartial<Test>,
      result: ({
        id: RESULT_ID,
        finished_at: 0,
      } as unknown) as ServerResult,
      resultID: RESULT_ID,
    },
  ]
  const RAW_POLL_RESULTS: RawPollResult = {
    data: [
      {
        type: 'result',
        attributes: POLL_RESULTS[0],
        id: RESULT_ID,
        relationships: {
          test: {
            data: {id: 'abc-def-ghi', type: 'test'},
          },
        },
      },
    ],
    included: [
      {
        id: 'abc-def-ghi',
        type: 'test',
        attributes: {
          ...API_TEST,
          config: {
            ...API_TEST.config,
            request: {
              ...API_TEST.config.request,
              dns_server: API_TEST.config.request.dnsServer,
            },
          },
        },
      },
    ],
  }
  const TRIGGERED_TEST_ID = 'fakeId'
  const TRIGGER_RESULTS: Trigger = {
    batch_id: BATCH_ID,
    locations: [LOCATION],
  }
  const PRESIGNED_URL_PAYLOAD = {
    url: 'wss://presigned.url',
  }

  test('should get results from api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: RAW_POLL_RESULTS})) as any)
    const api = apiConstructor(apiConfiguration)
    const results = await api.pollResults([RESULT_ID])
    expect(results[0].resultID).toBe(RESULT_ID)
  })

  test('should trigger tests using api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: TRIGGER_RESULTS})) as any)
    const api = apiConstructor(apiConfiguration)
    const {triggerTests} = api
    const tests: TestPayload[] = [{public_id: TRIGGERED_TEST_ID, executionRule: ExecutionRule.BLOCKING}]
    const {batch_id: batchId} = await triggerTests({tests})
    expect(batchId).toBe(BATCH_ID)
  })

  describe('Retry policy', () => {
    beforeEach(() => {
      jest.useFakeTimers({doNotFake: ['nextTick']})
      jest.restoreAllMocks()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    const MIN_ATTEMPTS = 1
    const MAX_ATTEMPTS = 4 // `MAX_RETRIES` + 1

    const fastForwardRetries = async () => {
      for (let i = 1; i <= MAX_ATTEMPTS - 1; i++) {
        // Skip the `setTimeout` in `await wait(waiter)`.
        jest.runOnlyPendingTimers()
        // Wait for the retry to happen, and for the next `setTimeout`.
        // This is used to flush promises, and requires `nextTick` not to be faked.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        await new Promise(process.nextTick)
      }
    }

    const api = apiConstructor(apiConfiguration)

    const cases = [
      {
        makeApiRequest: () => api.getBatch('batch-id'),
        name: 'get batch' as const,
        shouldBeRetriedOn404: true,
        shouldBeRetriedOn429: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () =>
          api.getMobileApplicationPresignedURLs('applicationId', 1025, MOBILE_PRESIGNED_UPLOAD_PARTS),
        name: 'get presigned url' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getTunnelPresignedURL(['test-id']),
        name: 'get presigned url' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getTest('public-id'),
        name: 'get test' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.pollResults(['result-id']),
        name: 'poll results' as const,
        shouldBeRetriedOn404: true,
        shouldBeRetriedOn429: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.searchTests('search query'),
        name: 'search tests' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () =>
          api.triggerTests({tests: [{public_id: '123-456-789', executionRule: ExecutionRule.NON_BLOCKING}]}),
        name: 'trigger tests' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getSyntheticsOrgSettings(),
        name: 'get settings' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn429: false,
        shouldBeRetriedOn5xx: true,
      },
    ]

    test.each(cases)(
      'should retry "$name" request (HTTP 404: $shouldBeRetriedOn404, HTTP 429: $shouldBeRetriedOn429, HTTP 5xx: $shouldBeRetriedOn5xx)',
      async ({makeApiRequest, shouldBeRetriedOn404, shouldBeRetriedOn429, shouldBeRetriedOn5xx}) => {
        const serverError = new AxiosError('Server Error')

        const requestMock = jest.fn().mockImplementation(() => {
          throw serverError
        })
        jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

        {
          serverError.response = {status: 404} as AxiosResponse

          const requestPromise = makeApiRequest()
          await fastForwardRetries()
          await expect(requestPromise).rejects.toThrow('Server Error')

          expect(requestMock).toHaveBeenCalledTimes(shouldBeRetriedOn404 ? MAX_ATTEMPTS : MIN_ATTEMPTS)
        }

        requestMock.mockClear()

        {
          serverError.response = {status: 429} as AxiosResponse

          const requestPromise = makeApiRequest()
          await fastForwardRetries()
          await expect(requestPromise).rejects.toThrow('Server Error')

          expect(requestMock).toHaveBeenCalledTimes(shouldBeRetriedOn429 ? MAX_ATTEMPTS : MIN_ATTEMPTS)
        }

        requestMock.mockClear()

        {
          serverError.response = {status: 502} as AxiosResponse

          const requestPromise = makeApiRequest()
          await fastForwardRetries()
          await expect(requestPromise).rejects.toThrow('Server Error')

          expect(requestMock).toHaveBeenCalledTimes(shouldBeRetriedOn5xx ? MAX_ATTEMPTS : MIN_ATTEMPTS)
        }
      }
    )

    test('should retry when socket hangs up', async () => {
      jest.spyOn(internalUtils, 'wait').mockImplementation()

      const requestSpy = jest.fn()

      const server = createServer((_, res) => {
        // ECONNRESET: socket hang up
        res.socket?.destroy()
        requestSpy()
      })

      server.listen()

      const {port} = server.address() as AddressInfo

      const localApi = apiConstructor({
        ...apiConfiguration,
        baseV1Url: `http://127.0.0.1:${port}`,
        baseV2Url: `http://127.0.0.1:${port}`,
      })

      await expect(localApi.getSyntheticsOrgSettings).rejects.toThrow('socket hang up')

      expect(requestSpy).toHaveBeenCalledTimes(MAX_ATTEMPTS)

      server.close()
    })
  })

  test('should get a mobile application presigned URL from api', async () => {
    const spy = jest
      .spyOn(axios, 'create')
      .mockImplementation((() => () => ({data: MOBILE_PRESIGNED_URLS_PAYLOAD})) as any)
    const api = apiConstructor(apiConfiguration)
    const {getMobileApplicationPresignedURLs} = api
    const result = await getMobileApplicationPresignedURLs('applicationId', 1025, MOBILE_PRESIGNED_UPLOAD_PARTS)
    expect(result).toEqual(MOBILE_PRESIGNED_URLS_PAYLOAD)
    spy.mockRestore()
  })

  test('should get a tunnel presigned URL from api', async () => {
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: PRESIGNED_URL_PAYLOAD})) as any)
    const api = apiConstructor(apiConfiguration)
    const {getTunnelPresignedURL} = api
    const {url} = await getTunnelPresignedURL([TRIGGERED_TEST_ID])
    expect(url).toEqual(PRESIGNED_URL_PAYLOAD.url)
    spy.mockRestore()
  })

  test('should upload a mobile application with a presigned URL', async () => {
    const mockRequest = jest.fn()
    mockRequest.mockReturnValue({status: 200, headers: {etag: '"123"'}})
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => mockRequest) as any)
    const api = apiConstructor(apiConfiguration)
    const {uploadMobileApplicationPart} = api
    const result = await uploadMobileApplicationPart(
      MOBILE_PRESIGNED_UPLOAD_PARTS,
      MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params
    )

    expect(result).toEqual([
      {ETag: '123', PartNumber: 1},
      {ETag: '123', PartNumber: 2},
    ])

    const callArg = mockRequest.mock.calls[0][0]
    expect(callArg.url).toBe(MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params.urls[1])
    expect(mockRequest).toHaveBeenCalledTimes(MOBILE_PRESIGNED_UPLOAD_PARTS.length)
    spy.mockRestore()
  })

  test('should return empty ETag when doing azure part upload', async () => {
    const mockRequest = jest.fn()
    mockRequest.mockReturnValue({status: 200, headers: {}})
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => mockRequest) as any)
    const api = apiConstructor(apiConfiguration)
    const {uploadMobileApplicationPart} = api

    const urls = {
      1: 'https://myaccount.blob.core.windows.net/mycontainer/myblob1',
      2: 'https://myaccount.blob.core.windows.net/mycontainer/myblob2',
    }

    const result = await uploadMobileApplicationPart(MOBILE_PRESIGNED_UPLOAD_PARTS, {
      ...MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params,
      // override fixture with azure urls
      urls,
    })

    expect(result).toEqual([
      {ETag: '', PartNumber: 1},
      {ETag: '', PartNumber: 2},
    ])

    const callArg = mockRequest.mock.calls[0][0]
    expect(callArg.url).toBe(urls[1])
    expect(mockRequest).toHaveBeenCalledTimes(MOBILE_PRESIGNED_UPLOAD_PARTS.length)
    spy.mockRestore()
  })

  test('should complete presigned mobile application upload', async () => {
    const jobId = 'fake_job_id'
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: {job_id: jobId}})) as any)
    const api = apiConstructor(apiConfiguration)
    const {completeMultipartMobileApplicationUpload} = api

    const appId = 'appId123'
    const partUploadResponses = Object.keys(MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params.urls).map(
      (partNumber) => ({
        PartNumber: Number(partNumber),
        ETag: 'etag',
      })
    )

    const result = await completeMultipartMobileApplicationUpload(
      appId,
      MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params.upload_id,
      MOBILE_PRESIGNED_URLS_PAYLOAD.multipart_presigned_urls_params.key,
      partUploadResponses
    )

    expect(result).toBe(jobId)
    spy.mockRestore()
  })

  test('should poll for app upload validation', async () => {
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: APP_UPLOAD_POLL_RESULTS})) as any)
    const api = apiConstructor(apiConfiguration)
    const {pollMobileApplicationUploadResponse} = api

    const jobId = 'jobId'

    const appUploadResult = await pollMobileApplicationUploadResponse(jobId)

    expect(appUploadResult).toEqual(APP_UPLOAD_POLL_RESULTS)
    spy.mockRestore()
  })

  test('should perform search with expected parameters', async () => {
    const requestMock = jest.fn(() => ({status: 200, data: {tests: []}}))
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

    const {searchTests} = apiConstructor(apiConfiguration)

    await expect(searchTests('tag:("test") creator:("Me") ???')).resolves.toEqual({tests: []})
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          count: MAX_TESTS_TO_TRIGGER + 1,
          text: 'tag:("test") creator:("Me") ???',
        },
      })
    )
    spy.mockRestore()
  })

  test('should receive settings', async () => {
    const settings = {onDemandConcurrencyCap: 10}
    const requestMock = jest.fn(() => ({status: 200, data: settings}))
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

    const {getSyntheticsOrgSettings: getSettings} = apiConstructor(apiConfiguration)

    await expect(getSettings()).resolves.toEqual(settings)
    spy.mockRestore()
  })

  describe('proxy configuration', () => {
    const tests = [{public_id: '123-456-789', executionRule: ExecutionRule.NON_BLOCKING}]
    let initialHttpProxyEnv: string | undefined

    beforeAll(() => {
      initialHttpProxyEnv = process.env.HTTP_PROXY
    })

    afterAll(() => {
      if (initialHttpProxyEnv !== undefined) {
        process.env.HTTP_PROXY = initialHttpProxyEnv
      } else {
        delete process.env.HTTP_PROXY
      }
    })

    beforeEach(() => {
      delete process.env.HTTP_PROXY
    })

    test('use proxy defined in configuration', async () => {
      const {close: proxyClose, config: proxyOpts, calls} = getSyntheticsProxy()

      try {
        const proxyApiConfiguration = {
          ...apiConfiguration,
          proxyOpts,
        }

        const api = apiConstructor(proxyApiConfiguration)

        const searchOutput = await api.searchTests('tag:test')
        expect(searchOutput).toEqual(mockSearchResponse)
        expect(calls.search).toHaveBeenCalled()

        const tunnelOutput = await api.getTunnelPresignedURL(['123-456-789'])
        expect(tunnelOutput).toEqual({url: expect.stringContaining('ws://127.0.0.1:')})
        expect(calls.presignedUrl).toHaveBeenCalled()

        const testOutput = await api.getTest('123-456-789')
        expect(testOutput).toEqual(getApiTest('123-456-789'))
        expect(calls.get).toHaveBeenCalled()

        const triggerOutput = await api.triggerTests({tests})
        expect(triggerOutput).toEqual(mockTestTriggerResponse)
        expect(calls.trigger).toHaveBeenCalledWith({tests})
      } finally {
        await proxyClose()
      }
    })

    test('use proxy defined in environment variable', async () => {
      const {close: proxyClose, config: proxyOpts, calls} = getSyntheticsProxy()
      process.env.HTTP_PROXY = `http://localhost:${proxyOpts.port}`

      try {
        const api = apiConstructor(apiConfiguration)

        const searchOutput = await api.searchTests('tag:test')
        expect(searchOutput).toEqual(mockSearchResponse)
        expect(calls.search).toHaveBeenCalled()

        const triggerOutput = await api.triggerTests({tests})
        expect(triggerOutput).toEqual(mockTestTriggerResponse)
        expect(calls.trigger).toHaveBeenCalledWith({tests})
      } finally {
        await proxyClose()
      }
    })

    test('use configuration proxy over environment variable', async () => {
      const {close: proxyClose, config: proxyOpts, calls} = getSyntheticsProxy()
      process.env.HTTP_PROXY = 'http://inexistanthost/'

      try {
        const proxyApiConfiguration = {
          ...apiConfiguration,
          proxyOpts,
        }
        const api = apiConstructor(proxyApiConfiguration)

        const triggerOutput = await api.triggerTests({tests})
        expect(triggerOutput).toEqual(mockTestTriggerResponse)
        expect(calls.trigger).toHaveBeenCalledWith({tests})
      } finally {
        await proxyClose()
      }
    })
  })
})

describe('getApiHelper', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('should throw an error if API or Application key are undefined', async () => {
    process.env = {}

    expect(() => getApiHelper(ciConfig)).toThrow(new CriticalError('MISSING_APP_KEY', 'App key is required'))

    expect(() => getApiHelper({...ciConfig, appKey: 'fakeappkey'})).toThrow(
      new CriticalError('MISSING_API_KEY', 'API key is required')
    )
  })
})

describe('formatBackendErrors', () => {
  test('backend error - no error', () => {
    const backendError = getAxiosError(500, {errors: []})
    expect(formatBackendErrors(backendError)).toBe('error querying https://app.datadoghq.com/example')
  })

  test('backend error - single error', () => {
    const backendError = getAxiosError(500, {errors: ['single error']})
    expect(formatBackendErrors(backendError)).toBe(
      'query on https://app.datadoghq.com/example returned: "single error"'
    )
  })

  test('backend error - multiple errors', () => {
    const backendError = getAxiosError(500, {errors: ['error 1', 'error 2']})
    expect(formatBackendErrors(backendError)).toBe(
      'query on https://app.datadoghq.com/example returned:\n  - error 1\n  - error 2'
    )
  })

  test('not a backend error', () => {
    const requestError = getAxiosError(403, {message: 'Forbidden'})
    expect(formatBackendErrors(requestError)).toBe('could not query https://app.datadoghq.com/example\nForbidden')
  })

  test('missing scope error', () => {
    const requestError = getAxiosError(403, {errors: ['Forbidden', 'Failed permission authorization checks']})
    expect(formatBackendErrors(requestError, 'synthetics_default_settings_read')).toBe(
      'query on https://app.datadoghq.com/example returned:\n  - Forbidden\n  - Failed permission authorization checks\nIs the App key granted the synthetics_default_settings_read scope?'
    )
  })
})
