import type {RequestResponse} from '@datadog/datadog-ci-base/helpers/request'

import * as requestModule from '@datadog/datadog-ci-base/helpers/request'

import {checkExistingDebugIds} from '../checkExists'

jest.mock('@datadog/datadog-ci-base/helpers/request', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/request'),
  httpRequest: jest.fn(),
}))

const mockedHttpRequest = jest.mocked(requestModule.httpRequest)

const successResponse = (results: Record<string, boolean>): RequestResponse => ({
  config: {},
  data: {data: {type: 'check_exists', id: 'check_exists', attributes: {results}}},
  headers: {},
  status: 200,
  statusText: 'OK',
})

describe('checkExists', () => {
  beforeEach(() => {
    mockedHttpRequest.mockReset()
  })

  test('posts debug IDs to the check_exists endpoint and returns results', async () => {
    mockedHttpRequest.mockResolvedValue(successResponse({'id-a': true, 'id-b': false}))

    const results = await checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', ['id-a', 'id-b'])

    expect(results).toStrictEqual({'id-a': true, 'id-b': false})
    expect(mockedHttpRequest).toHaveBeenCalledTimes(1)
    const config = mockedHttpRequest.mock.calls[0][0]
    expect(config.method).toBe('POST')
    expect(config.baseURL).toBe('https://api.datadoghq.com')
    expect(String(config.url)).toBe('/api/v2/sourcemaps/check_exists')
    expect(config.data).toStrictEqual({data: {type: 'check_exists', attributes: {debug_ids: ['id-a', 'id-b']}}})
    expect(config.headers).toMatchObject({
      'Content-Type': 'application/vnd.api+json',
      'DD-API-KEY': 'api-key',
      'DD-EVP-ORIGIN': 'datadog-ci_sourcemaps',
      'DD-EVP-ORIGIN-VERSION': '1.0.0',
    })
  })

  test('uses the datadog site for the API URL', async () => {
    mockedHttpRequest.mockResolvedValue(successResponse({}))

    await checkExistingDebugIds('api-key', 'datadoghq.eu', '1.0.0', ['id-a'])

    expect(mockedHttpRequest.mock.calls[0][0].baseURL).toBe('https://api.datadoghq.eu')
  })

  test('dedupes debug IDs', async () => {
    mockedHttpRequest.mockResolvedValue(successResponse({'id-a': true}))

    const results = await checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', ['id-a', 'id-a'])

    expect(results).toStrictEqual({'id-a': true})
    expect(mockedHttpRequest).toHaveBeenCalledTimes(1)
    expect(mockedHttpRequest.mock.calls[0][0].data).toStrictEqual({
      data: {type: 'check_exists', attributes: {debug_ids: ['id-a']}},
    })
  })

  test('returns an empty map without requesting when there are no debug IDs', async () => {
    const results = await checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', [])

    expect(results).toStrictEqual({})
    expect(mockedHttpRequest).not.toHaveBeenCalled()
  })

  test('chunks requests to at most 1000 debug IDs', async () => {
    const ids = Array.from({length: 1500}, (_, i) => `id-${i}`)
    mockedHttpRequest.mockImplementation(async (config) => {
      const chunk = (config.data as {data: {attributes: {debug_ids: string[]}}}).data.attributes.debug_ids

      return successResponse(Object.fromEntries(chunk.map((id) => [id, true])))
    })

    const results = await checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', ids)

    expect(mockedHttpRequest).toHaveBeenCalledTimes(2)
    const sentIds = (call: number) =>
      (mockedHttpRequest.mock.calls[call][0].data as {data: {attributes: {debug_ids: string[]}}}).data.attributes
        .debug_ids
    expect(sentIds(0)).toHaveLength(1000)
    expect(sentIds(1)).toHaveLength(500)
    expect(Object.keys(results)).toHaveLength(1500)
  })

  test('throws when the request fails', async () => {
    mockedHttpRequest.mockRejectedValue(new Error('Request failed with status code 404'))

    await expect(checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', ['id-a'])).rejects.toThrow('404')
  })

  test('throws when the response has no results', async () => {
    mockedHttpRequest.mockResolvedValue({config: {}, data: {}, headers: {}, status: 200, statusText: 'OK'})

    await expect(checkExistingDebugIds('api-key', 'datadoghq.com', '1.0.0', ['id-a'])).rejects.toThrow(
      'missing results'
    )
  })
})
