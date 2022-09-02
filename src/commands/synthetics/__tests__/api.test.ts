import {AxiosError, AxiosResponse, default as axios} from 'axios'

import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor, getApiHelper} from '../api'
import {MAX_TESTS_TO_TRIGGER} from '../command'
import {CriticalError} from '../errors'
import {
  APIConfiguration,
  ExecutionRule,
  PollResult,
  PresignedUrlResponse,
  ServerResult,
  TestPayload,
  Trigger,
} from '../interfaces'

import {ciConfig, getApiTest, getSyntheticsProxy, mockSearchResponse, mockTestTriggerResponse} from './fixtures'

describe('dd-api', () => {
  const apiConfiguration: APIConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const LOCATION = {
    display_name: 'fake location',
    id: 42,
    is_active: true,
    name: 'fake-loc',
    region: 'fake-region',
  }
  const RESULT_ID = '123'
  const BATCH_ID = 'bid'
  const POLL_RESULTS: {results: PollResult[]} = {
    results: [
      {
        check: getApiTest('abc-def-ghi'),
        result: ({} as unknown) as ServerResult,
        resultID: RESULT_ID,
        timestamp: 0,
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
  const MOBILE_PRESIGNED_URL_PAYLOAD: PresignedUrlResponse = {
    file_name: 'fileNameUuid',
    presigned_url_params: {url: 'https://www.presigned.url', fields: {}},
  }

  test('should get results from api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: POLL_RESULTS})) as any)
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
    const api = apiConstructor(apiConfiguration)

    const testCases = [
      {
        makeApiRequest: () => api.getBatch('batch-id'),
        name: 'get batch' as const,
        shouldBeRetriedOn404: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getMobileApplicationPresignedURL('applicationId', 'md5'),
        name: 'get presigned url' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getTunnelPresignedURL(['test-id']),
        name: 'get presigned url' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.getTest('public-id'),
        name: 'get test' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.pollResults(['result-id']),
        name: 'poll results' as const,
        shouldBeRetriedOn404: true,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () => api.searchTests('search query'),
        name: 'search tests' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn5xx: true,
      },
      {
        makeApiRequest: () =>
          api.triggerTests({tests: [{public_id: '123-456-789', executionRule: ExecutionRule.NON_BLOCKING}]}),
        name: 'trigger tests' as const,
        shouldBeRetriedOn404: false,
        shouldBeRetriedOn5xx: true,
      },
    ]

    test.each(testCases)(
      'should retry "$name" request (HTTP 404: $shouldBeRetriedOn404, HTTP 5xx: $shouldBeRetriedOn5xx)',
      async ({makeApiRequest, shouldBeRetriedOn404, shouldBeRetriedOn5xx}) => {
        const serverError = new Error('Server Error') as AxiosError

        const requestMock = jest.fn()
        requestMock.mockImplementation(() => {
          throw serverError
        })
        jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

        serverError.response = {status: 404} as AxiosResponse

        await expect(makeApiRequest()).rejects.toThrow()
        expect(requestMock).toHaveBeenCalledTimes(shouldBeRetriedOn404 ? 4 : 1)

        requestMock.mockClear()

        serverError.response = {status: 502} as AxiosResponse

        await expect(makeApiRequest()).rejects.toThrow()
        expect(requestMock).toHaveBeenCalledTimes(shouldBeRetriedOn5xx ? 4 : 1)
      }
    )
  })

  test('should get a mobile application presigned URL from api', async () => {
    const spy = jest
      .spyOn(axios, 'create')
      .mockImplementation((() => () => ({data: MOBILE_PRESIGNED_URL_PAYLOAD})) as any)
    const api = apiConstructor(apiConfiguration)
    const {getMobileApplicationPresignedURL} = api
    const result = await getMobileApplicationPresignedURL('applicationId', 'md5')
    expect(result).toEqual(MOBILE_PRESIGNED_URL_PAYLOAD)
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
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => mockRequest) as any)
    const api = apiConstructor(apiConfiguration)
    const {uploadMobileApplication} = api
    await uploadMobileApplication(Buffer.from('Mobile'), MOBILE_PRESIGNED_URL_PAYLOAD.presigned_url_params)

    const callArg = mockRequest.mock.calls[0][0]
    expect(callArg.url).toBe(MOBILE_PRESIGNED_URL_PAYLOAD.presigned_url_params.url)
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

    expect(() => getApiHelper(ciConfig)).toThrow(new CriticalError('MISSING_APP_KEY'))

    expect(() => getApiHelper({...ciConfig, appKey: 'fakeappkey'})).toThrow(new CriticalError('MISSING_API_KEY'))
  })
})
