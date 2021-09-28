// tslint:disable: no-string-literal
import {AxiosError, AxiosResponse} from 'axios'
import * as ciUtils from '../../../helpers/utils'
import {CiError, CriticalError} from '../errors'
import {ExecutionRule} from '../interfaces'
import * as runTests from '../run-test'
import * as utils from '../utils'
import {config, mockReporter} from './fixtures'

describe('run-test', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    process.env = {}
  })

  describe('execute', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })
    test('should apply config override for tests triggered by public id', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [],
        })
      )
      jest.spyOn(utils, 'runTests').mockImplementation()

      const startUrl = '{{PROTOCOL}}//myhost{{PATHNAME}}{{PARAMS}}'
      const locations = ['location1', 'location2']
      const configOverride = {locations, startUrl}

      const apiHelper = {}

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => ({} as any))
      try {
        await runTests.executeTests(mockReporter, {
          ...config,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      } catch (error) {
        expect(getTestsToTriggersMock).toHaveBeenCalledWith(
          apiHelper,
          expect.arrayContaining([
            expect.objectContaining({id: 'public-id-1', config: configOverride}),
            expect.objectContaining({id: 'public-id-2', config: configOverride}),
          ]),
          expect.anything()
        )
      }
    })

    test('should not wait for `skipped` only tests batch results', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [],
        })
      )

      const apiHelper = {}
      const configOverride = {executionRule: ExecutionRule.SKIPPED}

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => ({} as any))
      try {
        await runTests.executeTests(mockReporter, {
          ...config,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      } catch (error) {
        expect(getTestsToTriggersMock).toHaveBeenCalledWith(
          apiHelper,
          expect.arrayContaining([
            expect.objectContaining({id: 'public-id-1', config: configOverride}),
            expect.objectContaining({id: 'public-id-2', config: configOverride}),
          ]),
          expect.anything()
        )
        expect(error).toBeInstanceOf(CiError)
        expect(error).toHaveProperty('code', 'NO_TESTS_TO_RUN')
      }
    })

    test('should not open tunnel if no test to run', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [],
        })
      )

      const apiHelper = {
        getPresignedURL: jest.fn(),
      }
      const configOverride = {executionRule: ExecutionRule.SKIPPED}
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      try {
        await runTests.executeTests(mockReporter, {
          ...config,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
          tunnel: true,
        })
      } catch (error) {
        expect(getTestsToTriggersMock).toHaveBeenCalledWith(
          apiHelper,
          expect.arrayContaining([
            expect.objectContaining({id: 'public-id-1', config: configOverride}),
            expect.objectContaining({id: 'public-id-2', config: configOverride}),
          ]),
          expect.anything()
        )
        expect(apiHelper.getPresignedURL).not.toHaveBeenCalled()
        expect(error).toBeInstanceOf(CiError)
        expect(error).toHaveProperty('code', 'NO_TESTS_TO_RUN')
      }
    })

    test('getTestsList throws', async () => {
      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        searchTests: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
      try {
        await runTests.executeTests(mockReporter, {...config, testSearchQuery: 'a-search-query', tunnel: true})
      } catch (error) {
        expect(error).toBeInstanceOf(CriticalError)
        expect(error).toHaveProperty('code', 'UNAVAILABLE_TEST_CONF')
      }
    })

    test('getTestsToTrigger throws', async () => {
      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getTest: jest.fn(() => {
          throw serverError
        }),
      }
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      try {
        await runTests.executeTests(mockReporter, {...config, publicIds: ['public-id-1'], tunnel: true})
      } catch (error) {
        expect(error).toBeInstanceOf(CriticalError)
        expect(error).toHaveProperty('code', 'UNAVAILABLE_TEST_CONF')
      }
    })

    test('getPresignedURL throws', async () => {
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getPresignedURL: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      try {
        await runTests.executeTests(mockReporter, {...config, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      } catch (error) {
        expect(error).toBeInstanceOf(CriticalError)
        expect(error).toHaveProperty('code', 'UNAVAILABLE_TUNNEL_CONF')
      }
    })

    test('runTests throws', async () => {
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        triggerTests: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      try {
        await runTests.executeTests(mockReporter, {...config, publicIds: ['public-id-1', 'public-id-2']})
      } catch (error) {
        expect(error).toBeInstanceOf(CriticalError)
        expect(error).toHaveProperty('code', 'TRIGGER_TESTS_FAILED')
      }
    })

    test('waitForResults throws', async () => {
      const location = {
        display_name: 'us1',
        id: 1,
        is_active: true,
        name: 'us1',
        region: 'us1',
      }
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {criticalErrors: 0, passed: 0, failed: 0, skipped: 0, notFound: 0, timedOut: 0},
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      jest.spyOn(utils, 'runTests').mockReturnValue(
        Promise.resolve({
          locations: [location],
          results: [{device: 'chrome_laptop.large', location: 1, public_id: 'publicId', result_id: '1111'}],
          triggered_check_ids: [],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}

      const apiHelper = {
        pollResults: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      try {
        await runTests.executeTests(mockReporter, {
          ...config,
          failOnCriticalErrors: true,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      } catch (error) {
        expect(error).toBeInstanceOf(CriticalError)
        expect(error).toHaveProperty('code', 'POLL_RESULTS_FAILED')
      }
    })
  })

  describe('getDatadogHost', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should default to datadog us api', async () => {
      process.env = {}

      expect(runTests.getDatadogHost(false, config)).toBe('https://api.datadoghq.com/api/v1')
      expect(runTests.getDatadogHost(true, config)).toBe('https://intake.synthetics.datadoghq.com/api/v1')
    })

    test('should be tunable through DATADOG_SITE variable', async () => {
      process.env = {DATADOG_SITE: 'datadoghq.eu'}

      expect(runTests.getDatadogHost(false, {...config, datadogSite: process.env.DATADOG_SITE as string})).toBe(
        'https://api.datadoghq.eu/api/v1'
      )
      expect(runTests.getDatadogHost(true, {...config, datadogSite: process.env.DATADOG_SITE as string})).toBe(
        'https://api.datadoghq.eu/api/v1'
      )
    })
  })

  describe('getApiHelper', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should throw an error if API or Application key are undefined', async () => {
      process.env = {}

      expect(() => {
        runTests.getApiHelper(config)
      }).toThrow(new CiError('MISSING_APP_KEY'))

      try {
        await runTests.executeTests(mockReporter, config)
      } catch (error) {
        expect(error).toBeInstanceOf(CiError)
        expect(error).toHaveProperty('code', 'MISSING_APP_KEY')
      }

      expect(() => {
        runTests.getApiHelper({...config, appKey: 'fakeappkey'})
      }).toThrow(new CiError('MISSING_API_KEY'))

      try {
        await runTests.executeTests(mockReporter, {...config, appKey: 'fakeappkey'})
      } catch (error) {
        expect(error).toBeInstanceOf(CiError)
        expect(error).toHaveProperty('code', 'MISSING_API_KEY')
      }
    })
  })
  describe('getTestsList', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    const conf1 = {
      tests: [{config: {}, id: 'abc-def-ghi'}],
    }
    const conf2 = {
      tests: [{config: {}, id: 'jkl-mno-pqr'}],
    }
    const startUrl = 'fakeUrl'
    const fakeApi = {
      searchTests: () => ({
        tests: [
          {
            public_id: 'stu-vwx-yza',
          },
        ],
      }),
    } as any

    test('should find all tests and extend global config', async () => {
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf1, conf2]) as any)
      const configOverride = {startUrl}

      expect(await runTests.getTestsList(fakeApi, {...config, global: configOverride}, mockReporter)).toEqual([
        {
          config: {startUrl},
          id: 'abc-def-ghi',
        },
        {
          config: {startUrl},
          id: 'jkl-mno-pqr',
        },
      ])
    })

    test('should search tests and extend global config', async () => {
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf1, conf2]) as any)
      const configOverride = {startUrl}
      const searchQuery = 'fake search'

      expect(
        await runTests.getTestsList(
          fakeApi,
          {...config, global: configOverride, testSearchQuery: searchQuery},
          mockReporter
        )
      ).toEqual([
        {
          config: {startUrl},
          id: 'stu-vwx-yza',
        },
      ])
    })

    test('should use given globs to get tests list', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf1, conf2]) as any)
      const configOverride = {startUrl}
      const files = ['new glob', 'another one']

      await runTests.getTestsList(fakeApi, {...config, global: configOverride, files}, mockReporter)
      expect(getSuitesMock).toHaveBeenCalledTimes(2)
      expect(getSuitesMock).toHaveBeenCalledWith('new glob', mockReporter)
      expect(getSuitesMock).toHaveBeenCalledWith('another one', mockReporter)
    })
  })
})
