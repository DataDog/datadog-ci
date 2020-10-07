import axios from 'axios'

import {apiConstructor} from '../api'
import {Payload, PollResult, ProxyConfiguration, Result, Trigger} from '../interfaces'

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
        dc_id: 0,
        result: {} as Result,
        resultID: RESULT_ID,
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
    const testsToTrigger: Payload[] = [{public_id: TRIGGERED_TEST_ID}]
    const {results, triggered_check_ids} = await triggerTests(testsToTrigger)
    expect(triggered_check_ids).toEqual([TRIGGERED_TEST_ID])
    expect(results[0].public_id).toBe(TRIGGERED_TEST_ID)
    expect(results[0].result_id).toBe(RESULT_ID)
  })
})
