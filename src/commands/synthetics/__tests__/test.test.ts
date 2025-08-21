import {default as axios} from 'axios'

import {getAxiosError} from '../../../helpers/__tests__/testing-tools'
import {ProxyConfiguration} from '../../../helpers/utils'

import {APIHelper, apiConstructor} from '../api'
import {CiError} from '../errors'
import {ExecutionRule} from '../interfaces'
import * as mobile from '../mobile'
import {getTestAndOverrideConfig, getTestsFromSearchQuery, getTestsToTrigger, MAX_TESTS_TO_TRIGGER} from '../test'
import {InitialSummary} from '../utils/public'

import {getApiTest, getSummary, mockReporter} from './fixtures'

describe('getTestsFromSearchQuery', () => {
  it('should return an empty array if an empty string is given', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {defaultTestOverrides: {}, testSearchQuery: ''}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })

  it('should return an empty array if no tests are found', async () => {
    const api = {
      searchTests: jest.fn().mockResolvedValue({tests: []}),
    }
    const config = {defaultTestOverrides: {}, testSearchQuery: 'my search query'}

    const result = await getTestsFromSearchQuery(api as any, config)

    expect(result).toEqual([])
  })
})

describe('getTestsToTrigger', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseV1Url: 'basev1',
    baseV2Url: 'basev2',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  const fakeTests: {[id: string]: any} = {
    '123-456-789': {
      config: {request: {url: 'http://example.org/'}},
      name: 'Fake Test',
      public_id: '123-456-789',
      suite: 'Suite 1',
    },
    'mob-ile-tes': {
      config: {},
      name: 'Fake Mobile Test',
      options: {
        mobileApplication: {
          applicationId: 'appId',
          referenceId: 'versionId',
          referenceType: 'version',
        },
      },
      public_id: 'mob-ile-tes',
      suite: 'Suite 3',
      type: 'mobile',
    },
    'ski-ppe-d01': {
      config: {request: {url: 'http://example.org/'}},
      name: 'Skipped Fake Test',
      options: {ci: {executionRule: 'skipped'}},
      public_id: 'ski-ppe-d01',
      suite: 'Suite 3',
    },
  }

  beforeEach(() => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      const publicId = e.url.slice(18)
      if (fakeTests[publicId]) {
        return {data: fakeTests[publicId]}
      }

      throw getAxiosError(404, {errors: ['Not found']})
    }) as any)
  })

  test('only existing tests are returned', async () => {
    const triggerConfigs = [
      {suite: 'Suite 1', id: '123-456-789'},
      {suite: 'Suite 2', id: '987-654-321'},
      {suite: 'Suite 3', id: 'ski-ppe-d01'},
    ]
    const {tests, overriddenTestsToTrigger, initialSummary} = await getTestsToTrigger(api, triggerConfigs, mockReporter)

    expect(tests).toStrictEqual([fakeTests['123-456-789']])
    expect(overriddenTestsToTrigger).toStrictEqual([{public_id: '123-456-789', version: undefined}, {public_id: 'ski-ppe-d01', version: undefined}])

    const expectedSummary: InitialSummary = {
      criticalErrors: 0,
      expected: 0,
      failed: 0,
      failedNonBlocking: 0,
      passed: 0,
      previouslyPassed: 0,
      skipped: 1,
      testsNotAuthorized: new Set(),
      testsNotFound: new Set(['987-654-321']),
      timedOut: 0,
    }
    expect(initialSummary).toEqual(expectedSummary)
  })

  test('no tests triggered throws an error', async () => {
    await expect(getTestsToTrigger(api, [], mockReporter)).rejects.toEqual(new CiError('NO_TESTS_TO_RUN'))
  })

  describe('too many tests to trigger', () => {
    const fakeApi: APIHelper = {
      ...api,
      getTest: (id: string) => {
        if (id === 'missing') {
          throw new Error('Request error')
        }

        const test = {...getApiTest(id)}
        if (id === 'skipped') {
          test.options.ci = {executionRule: ExecutionRule.SKIPPED}
        }

        return Promise.resolve(test)
      },
    }

    test('trim and warn if from search', async () => {
      const tooManyTests = Array(MAX_TESTS_TO_TRIGGER + 10).fill({id: 'stu-vwx-yza'})
      const tests = await getTestsToTrigger(fakeApi, tooManyTests, mockReporter, true)
      expect(tests.tests.length).toBe(MAX_TESTS_TO_TRIGGER)
      expect(mockReporter.initErrors).toMatchSnapshot()
    })

    test('fails outside of search', async () => {
      const tooManyTests = Array(MAX_TESTS_TO_TRIGGER + 10).fill({id: 'stu-vwx-yza'})
      await expect(getTestsToTrigger(fakeApi, tooManyTests, mockReporter, false)).rejects.toEqual(
        new Error(`Cannot trigger more than ${MAX_TESTS_TO_TRIGGER} tests (received ${tooManyTests.length})`)
      )
    })

    test('does not account for skipped/not found tests outside of search', async () => {
      const tooManyTests = [...Array(MAX_TESTS_TO_TRIGGER).fill({id: 'stu-vwx-yza'}), {id: 'skipped'}, {id: 'missing'}]
      const tests = await getTestsToTrigger(fakeApi, tooManyTests, mockReporter, true)
      expect(tests.tests.length).toBe(MAX_TESTS_TO_TRIGGER)
    })
  })

  test('call uploadApplicationAndOverrideConfig on mobile test', async () => {
    const spy = jest.spyOn(mobile, 'uploadMobileApplicationsAndUpdateOverrideConfigs').mockImplementation()
    const triggerConfigs = [
      {suite: 'Suite 1', id: '123-456-789'},
      {suite: 'Suite 3', id: 'mob-ile-tes'},
    ]

    await getTestsToTrigger(api, triggerConfigs, mockReporter)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('getTestAndOverrideConfig', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUnstableUrl: 'baseUnstable',
    baseV1Url: 'basev1',
    baseV2Url: 'basev2',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  test('Forbidden error when getting a test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      throw getAxiosError(403, {message: 'Forbidden'})
    }) as any)

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}

    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toStrictEqual({
      errorMessage: '[123-456-789] Test not authorized: could not query https://app.datadoghq.com/example\nForbidden',
    })
  })

  test('Passes when public ID is valid', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
    )
  })

  test('Fails when public ID is NOT valid', async () => {
    const expectedError = new CiError('INVALID_CONFIG', `No valid public ID found in: \`a123-456-789\``)

    const triggerConfig = {suite: 'Suite 1', id: 'a123-456-789'}
    await expect(getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).rejects.toThrow(
      expectedError
    )
  })

  test('Version not found error when version is provided', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      if (e.url?.includes('/synthetics/tests/123-456-789/version_history/50')) {
        throw getAxiosError(404, {errors: ['Version not found']})
      }
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {id: '123-456-789', version: 50}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toStrictEqual({
      errorMessage: '[123-456-789@50] Test version not found: query on https://app.datadoghq.com/example returned: "Version not found"',
    })
  })

  test('Passes when version exists and is provided', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      if (e.url?.includes('/synthetics/tests/123-456-789/version_history/50')) {
        return {data: {}}
      }
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {id: '123-456-789', version: 50}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary())).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
    )
  })

  test('Passes when the tunnel is enabled for HTTP test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {subtype: 'http', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
    expect(await getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).toEqual(
      expect.objectContaining({test: expect.objectContaining({public_id: '123-456-789', subtype: 'http'})})
    )
  })

  test('Passes when the tunnel is enabled for Browser test', async () => {
    const axiosMock = jest.spyOn(axios, 'create')
    axiosMock.mockImplementation((() => (e: any) => {
      return {data: {type: 'browser', public_id: '123-456-789'}}
    }) as any)

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
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

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
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

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
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

    const triggerConfig = {suite: 'Suite 1', id: '123-456-789'}
    await expect(() => getTestAndOverrideConfig(api, triggerConfig, mockReporter, getSummary(), true)).rejects.toThrow(
      'The tunnel is only supported with HTTP API tests and Browser tests (public ID: 123-456-789, type: api, sub-type: multi, step sub-types: [dns, ssl]).'
    )
  })
})
