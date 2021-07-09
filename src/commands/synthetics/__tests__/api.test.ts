import {AxiosError, AxiosResponse, default as axios} from 'axios'

import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {ExecutionRule, PollResult, Result, TestPayload, Trigger} from '../interfaces'

import {getApiTest} from './fixtures'

describe('dd-api', () => {
  const apiConfiguration = {
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
        dc_id: 0,
        result: {} as Result,
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
    triggered_check_ids: [TRIGGERED_TEST_ID],
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
    const {results, triggered_check_ids} = await triggerTests({tests})
    expect(triggered_check_ids).toEqual([TRIGGERED_TEST_ID])
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
    try {
      await getTest('fake-public-id')
    } catch {
      // Empty catch as it is expected to throw
    }
    expect(requestMock).toHaveBeenCalledTimes(4)
  })

  test('shoud get a presigned URL from api', async () => {
    jest.spyOn(axios, 'create').mockImplementation((() => () => ({data: PRESIGNED_URL_PAYLOAD})) as any)
    const api = apiConstructor(apiConfiguration)
    const {getPresignedURL} = api
    const {url} = await getPresignedURL([TRIGGERED_TEST_ID])
    expect(url).toEqual(PRESIGNED_URL_PAYLOAD.url)
  })
})
