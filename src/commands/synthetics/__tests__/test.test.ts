import {default as axios} from 'axios'

import {getAxiosError} from '../../../helpers/__tests__/fixtures'
import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {CiError} from '../errors'
import {getTestAndOverrideConfig, getTestsFromSearchQuery} from '../test'

import {getSummary, mockReporter} from './fixtures'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if an empty string is given', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
    const config = {global: {}, defaultTestOverrides: {}, testSearchQuery: ''}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })

  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
    const config = {global: {}, defaultTestOverrides: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })
})

describe('getTestAndOverrideConfig', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  test('Forbidden error when getting a test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      throw getAxiosError(403, {message: 'Forbidden'})
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}

    await expect(() => getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).rejects.toThrow(
      'Failed to get test: could not query https://app.datadoghq.com/example\nForbidden\n'
    )
  })

  test('Passes when public ID is valid', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
    )
  })

  test('Fails when public ID is NOT valid', async () => {
    const expectedError = new CiError('INVALID_CONFIG', `No valid public ID found in: \`a123-456-789\``)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: 'a123-456-789'}
    await expect(getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).rejects.toThrow(
      expectedError
    )
  })

  test('Passes when the tunnel is enabled for HTTP test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
    )
  })

  test('Passes when the tunnel is enabled for Browser test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {type: 'browser', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', type: 'browser'})})
    )
  })

  test('Passes when the tunnel is enabled for Multi step test with HTTP steps only', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {
        data: {
          type: 'api',
          subtype: 'multi',
          config: {steps: [{subtype: 'http'}, {subtype: 'http'}]},
          public_id: '123-456-789',
        },
      }
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
      expect.objectContaining({
        test: expect.objectContaining({
          public_id: '123-456-789',
          type: 'api',
          subtype: 'multi',
          config: {steps: [{subtype: 'http'}, {subtype: 'http'}]},
        }),
      })
    )
  })

  test('Fails when the tunnel is enabled for an unsupported test type', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {subtype: 'grpc', type: 'api', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    await expect(() => getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).rejects.toThrow(
      'The tunnel is only supported with HTTP API tests and Browser tests (public ID: 123-456-789, type: api, sub-type: grpc).'
    )
  })

  test('Fails when the tunnel is enabled for unsupported steps in a Multi step test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {
        data: {
          type: 'api',
          subtype: 'multi',
          config: {steps: [{subtype: 'dns'}, {subtype: 'ssl'}, {subtype: 'http'}]},
          public_id: '123-456-789',
        },
      }
    }) as any)

    const triggerConfig = {suite: 'Suite 1', config: {}, id: '123-456-789'}
    await expect(() => getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).rejects.toThrow(
      'The tunnel is only supported with HTTP API tests and Browser tests (public ID: 123-456-789, type: api, sub-type: multi, step sub-types: [dns, ssl]).'
    )
  })
})
