import {AxiosError, AxiosResponse, default as axios} from 'axios'

import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {APIConfiguration, ExecutionRule, PollResult, ServerResult, TestPayload, Trigger} from '../interfaces'

import {getApiTest, getSyntheticsProxy, mockSearchResponse, mockTestTriggerResponse} from './fixtures'

describe('dd-api', () => {
  const apiConfiguration: APIConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
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
    locations: [LOCATION],
    results: [
      {
        device: 'laptop_large',
        location: 42,
        public_id: TRIGGERED_TEST_ID,
        result_id: RESULT_ID,
      },
    ],
  }
  const PRESIGNED_URL_PAYLOAD = {
    url: 'wss://presigned.url',
  }

  test('should get results from api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: POLL_RESULTS})) as any)
    const api = apiConstructor(apiConfiguration)
    const {pollResults} = api
    const {results} = await pollResults([RESULT_ID])
    expect(results[0].resultID).toBe(RESULT_ID)
  })

  test('should trigger tests using api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: TRIGGER_RESULTS})) as any)
    const api = apiConstructor(apiConfiguration)
    const {triggerTests} = api
    const tests: TestPayload[] = [{public_id: TRIGGERED_TEST_ID, executionRule: ExecutionRule.BLOCKING}]
    const {results} = await triggerTests({tests})
    expect(results[0].public_id).toBe(TRIGGERED_TEST_ID)
    expect(results[0].result_id).toBe(RESULT_ID)
  })

  test('should retry request that failed with code 5xx', async () => {
    const serverError = new Error('Server Error') as AxiosError
    serverError.response = {status: 502} as AxiosResponse

    const requestMock = jest.fn()
    requestMock.mockImplementation(() => {
      throw serverError
    })
    jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

    const {getTest} = apiConstructor(apiConfiguration)

    await expect(getTest('fake-public-id')).rejects.toThrow()
    expect(requestMock).toHaveBeenCalledTimes(4)
  })

  test('should get a presigned URL from api', async () => {
    const spy = jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: PRESIGNED_URL_PAYLOAD})) as any)
    const api = apiConstructor(apiConfiguration)
    const {getPresignedURL} = api
    const {url} = await getPresignedURL([TRIGGERED_TEST_ID])
    expect(url).toEqual(PRESIGNED_URL_PAYLOAD.url)
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

        const tunnelOutput = await api.getPresignedURL(['123-456-789'])
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
