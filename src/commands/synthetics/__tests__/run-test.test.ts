// tslint:disable: no-string-literal
import {AxiosError, AxiosResponse} from 'axios'
import * as ciUtils from '../../../helpers/utils'
import {CiError, CriticalCiErrorCode, CriticalError} from '../errors'
import {ExecutionRule} from '../interfaces'
import * as runTests from '../run-test'
import {Tunnel} from '../tunnel'
import * as utils from '../utils'
import {ciConfig, getApiPollResult, mockReporter, mockTestTriggerResponse} from './fixtures'

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

    test('open and close tunnel for successful runs', async () => {
      jest.spyOn(utils, 'wait').mockImplementation(() => new Promise((res) => setTimeout(res, 10)))
      const startTunnelSpy = jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: utils.createSummary(),
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: '123-456-789'} as any],
        })
      )

      jest.spyOn(utils, 'runTests').mockResolvedValue({...mockTestTriggerResponse, triggered_check_ids: []})

      const apiHelper = {
        getPresignedURL: () => ({url: 'url'}),
        pollResults: () => ({results: [getApiPollResult('1')]}),
        triggerTests: () => mockTestTriggerResponse,
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await runTests.executeTests(mockReporter, {
        ...ciConfig,
        failOnCriticalErrors: true,
        publicIds: ['123-456-789'],
        tunnel: true,
      })

      expect(startTunnelSpy).toHaveBeenCalledTimes(1)
      expect(stopTunnelSpy).toHaveBeenCalledTimes(1)
    })

    const cases: [number, CriticalCiErrorCode][] = [
      [403, 'AUTHORIZATION_ERROR'],
      [502, 'UNAVAILABLE_TEST_CONFIG'],
    ]
    describe.each(cases)('%s triggers %s', (status, error) => {
      test(`getTestsList throws - ${status}`, async () => {
        const serverError = new Error('Server Error') as AxiosError
        serverError.response = {data: {errors: ['Error']}, status} as AxiosResponse
        serverError.config = {baseURL: 'baseURL', url: 'url'}
        const apiHelper = {
          searchTests: jest.fn(() => {
            throw serverError
          }),
        }
        jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, testSearchQuery: 'a-search-query', tunnel: true})
        ).rejects.toMatchError(new CriticalError(error))
      })

      test(`getTestsToTrigger throws - ${status}`, async () => {
        const serverError = new Error('Server Error') as AxiosError
        serverError.response = {data: {errors: ['Bad Gateway']}, status} as AxiosResponse
        serverError.config = {baseURL: 'baseURL', url: 'url'}
        const apiHelper = {
          getTest: jest.fn(() => {
            throw serverError
          }),
        }
        jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1'], tunnel: true})
        ).rejects.toMatchError(new CriticalError(error))
      })
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
      jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

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
        getPresignedURL: () => ({url: 'url'}),
        triggerTests: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toMatchError(new CriticalError('TRIGGER_TESTS_FAILED'))
      expect(stopTunnelSpy).toHaveBeenCalledTimes(1)
    })

    test('waitForResults throws', async () => {
      const location = {
        display_name: 'us1',
        id: 1,
        is_active: true,
        name: 'us1',
        region: 'us1',
      }
      jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')
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
        getPresignedURL: () => ({url: 'url'}),
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
          tunnel: true,
        })
      ).rejects.toMatchError(new CriticalError('POLL_RESULTS_FAILED'))
      expect(stopTunnelSpy).toHaveBeenCalledTimes(1)
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

      expect(() => runTests.getApiHelper(ciConfig)).toThrow(new CriticalError('MISSING_APP_KEY'))
      await expect(runTests.executeTests(mockReporter, ciConfig)).rejects.toMatchError(
        new CriticalError('MISSING_APP_KEY')
      )
      expect(() => runTests.getApiHelper({...ciConfig, appKey: 'fakeappkey'})).toThrow(
        new CriticalError('MISSING_API_KEY')
      )
      await expect(runTests.executeTests(mockReporter, {...ciConfig, appKey: 'fakeappkey'})).rejects.toMatchError(
        new CriticalError('MISSING_API_KEY')
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
