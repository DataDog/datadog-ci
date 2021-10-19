// tslint:disable: no-string-literal
import {AxiosError, AxiosResponse} from 'axios'
import * as ciUtils from '../../../helpers/utils'
import {CiError, CriticalError} from '../errors'
import {ExecutionRule} from '../interfaces'
import * as runTests from '../run-test'
import * as utils from '../utils'
import {ciConfig, mockReporter} from './fixtures'

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
          summary: utils.createSummary(),
          tests: [],
        })
      )
      jest.spyOn(utils, 'runTests').mockImplementation()

      const startUrl = '{{PROTOCOL}}//myhost{{PATHNAME}}{{PARAMS}}'
      const locations = ['location1', 'location2']
      const configOverride = {locations, startUrl}

      const apiHelper = {}

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => ({} as any))

      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      ).rejects.toThrow()
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything()
      )
    })

    test('should not wait for `skipped` only tests batch results', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: utils.createSummary(),
          tests: [],
        })
      )

      const apiHelper = {}
      const configOverride = {executionRule: ExecutionRule.SKIPPED}

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => ({} as any))
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      ).rejects.toMatchError(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything()
      )
    })

    test('should not open tunnel if no test to run', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: utils.createSummary(),
          tests: [],
        })
      )

      const apiHelper = {
        getPresignedURL: jest.fn(),
      }
      const configOverride = {executionRule: ExecutionRule.SKIPPED}
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: configOverride,
          publicIds: ['public-id-1', 'public-id-2'],
          tunnel: true,
        })
      ).rejects.toMatchError(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything()
      )
      expect(apiHelper.getPresignedURL).not.toHaveBeenCalled()
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
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, testSearchQuery: 'a-search-query', tunnel: true})
      ).rejects.toMatchError(new CriticalError('UNAVAILABLE_TEST_CONFIG'))
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
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1'], tunnel: true})
      ).rejects.toMatchError(new CriticalError('UNAVAILABLE_TEST_CONFIG'))
    })

    test('getPresignedURL throws', async () => {
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: utils.createSummary(),
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
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toMatchError(new CriticalError('UNAVAILABLE_TUNNEL_CONFIG'))
    })

    test('runTests throws', async () => {
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: utils.createSummary(),
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
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2']})
      ).rejects.toMatchError(new CriticalError('TRIGGER_TESTS_FAILED'))
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
          summary: utils.createSummary(),
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
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          failOnCriticalErrors: true,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      ).rejects.toMatchError(new CriticalError('POLL_RESULTS_FAILED'))
    })
  })

  describe('getDatadogHost', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should default to datadog us api', async () => {
      process.env = {}

      expect(runTests.getDatadogHost(false, ciConfig)).toBe('https://api.datadoghq.com/api/v1')
      expect(runTests.getDatadogHost(true, ciConfig)).toBe('https://intake.synthetics.datadoghq.com/api/v1')
    })

    test('should use DD_API_HOST_OVERRIDE', async () => {
      process.env = {DD_API_HOST_OVERRIDE: 'https://foobar'}

      expect(runTests.getDatadogHost(true, ciConfig)).toBe('https://foobar/api/v1')
      expect(runTests.getDatadogHost(true, ciConfig)).toBe('https://foobar/api/v1')
    })

    test('should use Synthetics intake endpoint', async () => {
      expect(runTests.getDatadogHost(true, {...ciConfig, datadogSite: 'datadoghq.com' as string})).toBe(
        'https://intake.synthetics.datadoghq.com/api/v1'
      )
      expect(runTests.getDatadogHost(true, {...ciConfig, datadogSite: 'datad0g.com' as string})).toBe(
        'https://intake.synthetics.datad0g.com/api/v1'
      )
    })
  })

  describe('getApiHelper', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should throw an error if API or Application key are undefined', async () => {
      process.env = {}

      expect(() => runTests.getApiHelper(ciConfig)).toThrow(new CiError('MISSING_APP_KEY'))
      await expect(runTests.executeTests(mockReporter, ciConfig)).rejects.toMatchError(new CiError('MISSING_APP_KEY'))
      expect(() => runTests.getApiHelper({...ciConfig, appKey: 'fakeappkey'})).toThrow(new CiError('MISSING_API_KEY'))
      await expect(runTests.executeTests(mockReporter, {...ciConfig, appKey: 'fakeappkey'})).rejects.toMatchError(
        new CiError('MISSING_API_KEY')
      )
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
    const fakeSuites = [
      {
        content: conf1,
        name: 'Suite 1',
      },
      {
        content: conf2,
        name: 'Suite 2',
      },
    ]
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
      jest.spyOn(utils, 'getSuites').mockImplementation((() => fakeSuites) as any)
      const configOverride = {startUrl}

      await expect(
        runTests.getTestsList(fakeApi, {...ciConfig, global: configOverride}, mockReporter)
      ).resolves.toEqual([
        {
          config: {startUrl},
          id: 'abc-def-ghi',
          suite: 'Suite 1',
        },
        {
          config: {startUrl},
          id: 'jkl-mno-pqr',
          suite: 'Suite 2',
        },
      ])
    })

    test('should search tests and extend global config', async () => {
      jest.spyOn(utils, 'getSuites').mockImplementation((() => fakeSuites) as any)
      const configOverride = {startUrl}
      const searchQuery = 'fake search'

      await expect(
        runTests.getTestsList(
          fakeApi,
          {...ciConfig, global: configOverride, testSearchQuery: searchQuery},
          mockReporter
        )
      ).resolves.toEqual([
        {
          config: {startUrl},
          id: 'stu-vwx-yza',
          suite: 'Query: fake search',
        },
      ])
    })

    test('should use given globs to get tests list', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockImplementation((() => fakeSuites) as any)
      const configOverride = {startUrl}
      const files = ['new glob', 'another one']

      await runTests.getTestsList(fakeApi, {...ciConfig, global: configOverride, files}, mockReporter)
      expect(getSuitesMock).toHaveBeenCalledTimes(2)
      expect(getSuitesMock).toHaveBeenCalledWith('new glob', mockReporter)
      expect(getSuitesMock).toHaveBeenCalledWith('another one', mockReporter)
    })
  })
})
