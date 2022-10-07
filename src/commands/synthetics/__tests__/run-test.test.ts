// tslint:disable: no-string-literal

import {AxiosError, AxiosResponse} from 'axios'
import {promises as fs} from 'fs'
import * as ciUtils from '../../../helpers/utils'
import * as api from '../api'
import {MAX_TESTS_TO_TRIGGER} from '../command'
import {CiError, CriticalCiErrorCode, CriticalError} from '../errors'
import {ExecutionRule, SyntheticsCIConfig, UserConfigOverride} from '../interfaces'
import * as runTests from '../run-test'
import {Tunnel} from '../tunnel'
import * as utils from '../utils'
import {
  ciConfig,
  getApiResult,
  getApiTest,
  getMobileTest,
  MOBILE_PRESIGNED_URL_PAYLOAD,
  mockReporter,
  mockTestTriggerResponse,
} from './fixtures'

describe('run-test', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    process.env = {}
  })

  describe('execute', () => {
    test('should apply config override for tests triggered by public id', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [],
        })
      )
      jest.spyOn(utils, 'runTests').mockImplementation()

      const startUrl = '{{PROTOCOL}}//myhost{{PATHNAME}}{{PARAMS}}'
      const locations = ['location1', 'location2']
      const userConfigOverride = {locations, startUrl}

      const apiHelper = {}

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => ({} as any))

      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: userConfigOverride,
          publicIds: ['public-id-1', 'public-id-2'],
        })
      ).rejects.toThrow()
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: userConfigOverride}),
          expect.objectContaining({id: 'public-id-2', config: userConfigOverride}),
        ]),
        expect.anything(),
        false,
        false
      )
    })

    test.each([
      [
        'locations in global config only',
        {global: {locations: ['global-location-1']}},
        {locations: ['global-location-1']},
      ],
      [
        'locations in env var only',
        {locations: ['envvar-location-1', 'envvar-location-2']},
        {locations: ['envvar-location-1', 'envvar-location-2']},
      ],
      [
        'locations in both global config and env var',
        {global: {locations: ['global-location-1']}, locations: ['envvar-location-1', 'envvar-location-2']},
        {locations: ['envvar-location-1', 'envvar-location-2']},
      ],
    ] as [string, Partial<SyntheticsCIConfig>, UserConfigOverride][])(
      'Use appropriate list of locations for tests triggered by public id: %s',
      async (text, partialCIConfig, expectedOverriddenConfig) => {
        const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
          Promise.resolve({
            initialSummary: utils.createInitialSummary(),
            overriddenTestsToTrigger: [],
            tests: [],
          })
        )

        const apiHelper = {}

        jest.spyOn(api, 'getApiHelper').mockImplementation(() => ({} as any))
        await expect(
          runTests.executeTests(mockReporter, {
            ...ciConfig,
            ...partialCIConfig,
            publicIds: ['public-id-1', 'public-id-2'],
          })
        ).rejects.toMatchError(new CiError('NO_TESTS_TO_RUN'))
        expect(getTestsToTriggersMock).toHaveBeenCalledWith(
          apiHelper,
          expect.arrayContaining([
            expect.objectContaining({id: 'public-id-1', config: expectedOverriddenConfig}),
            expect.objectContaining({id: 'public-id-2', config: expectedOverriddenConfig}),
          ]),
          expect.anything(),
          false,
          false
        )
      }
    )

    test('should not wait for `skipped` only tests batch results', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [],
        })
      )

      const apiHelper = {}
      const configOverride = {executionRule: ExecutionRule.SKIPPED}

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => ({} as any))
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
        expect.anything(),
        false,
        false
      )
    })

    test('should not open tunnel if no test to run', async () => {
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [],
        })
      )

      const apiHelper = {
        getTunnelPresignedURL: jest.fn(),
      }
      const configOverride = {executionRule: ExecutionRule.SKIPPED}
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

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
        expect.anything(),
        false,
        false
      )
      expect(apiHelper.getTunnelPresignedURL).not.toHaveBeenCalled()
    })

    test('open and close tunnel for successful runs', async () => {
      jest.spyOn(utils, 'wait').mockImplementation(() => new Promise((res) => setTimeout(res, 10)))
      const startTunnelSpy = jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: '123-456-789'} as any],
        })
      )

      jest.spyOn(utils, 'runTests').mockResolvedValue(mockTestTriggerResponse)

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: () => [getApiResult('1', getApiTest())],
        triggerTests: () => mockTestTriggerResponse,
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
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
        jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, testSearchQuery: 'a-search-query', tunnel: true})
        ).rejects.toMatchError(new CriticalError(error, 'Server Error'))
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
        jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1'], tunnel: true})
        ).rejects.toMatchError(new CriticalError(error, 'Server Error'))
      })
    })

    test('getTunnelPresignedURL throws', async () => {
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getTunnelPresignedURL: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toMatchError(new CriticalError('UNAVAILABLE_TUNNEL_CONFIG', 'Server Error'))
    })

    test('getMobileApplicationPresignedURL throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(utils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      jest.spyOn(fs, 'readFile').mockImplementation(async () => Buffer.from('aa'))

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getMobileApplicationPresignedURL: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toMatchError(new CriticalError('UPLOAD_MOBILE_APPLICATION_TESTS_FAILED', 'Server Error'))
    })

    test('uploadMobileApplication throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(utils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      jest.spyOn(fs, 'readFile').mockImplementation(async () => Buffer.from('aa'))

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getMobileApplicationPresignedURL: jest.fn(() => MOBILE_PRESIGNED_URL_PAYLOAD),
        uploadMobileApplication: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toMatchError(new CriticalError('UPLOAD_MOBILE_APPLICATION_TESTS_FAILED', 'Server Error'))
    })

    test('runTests throws', async () => {
      jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getTunnelPresignedURL: () => ({url: 'url'}),
        triggerTests: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toMatchError(
        new CriticalError(
          'TRIGGER_TESTS_FAILED',
          '[] Failed to trigger tests: query on baseURLurl returned: "Bad Gateway"\n'
        )
      )
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
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      jest.spyOn(utils, 'runTests').mockReturnValue(
        Promise.resolve({
          batch_id: 'bid',
          locations: [location],
        })
      )

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: jest.fn(() => {
          throw serverError
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          failOnCriticalErrors: true,
          publicIds: ['public-id-1', 'public-id-2'],
          tunnel: true,
        })
      ).rejects.toMatchError(
        new CriticalError(
          'POLL_RESULTS_FAILED',
          'Failed to poll results: query on baseURLurl returned: "Bad Gateway"\n'
        )
      )
      expect(stopTunnelSpy).toHaveBeenCalledTimes(1)
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

    test('display warning if too many tests from search', async () => {
      const apiHelper = {
        searchTests: () => ({
          tests: Array(MAX_TESTS_TO_TRIGGER + 1).fill({public_id: 'stu-vwx-yza'}),
        }),
      } as any

      const searchQuery = 'fake search'

      await runTests.getTestsList(apiHelper, {...ciConfig, testSearchQuery: searchQuery}, mockReporter)
      expect(mockReporter.error).toHaveBeenCalledWith(
        `More than ${MAX_TESTS_TO_TRIGGER} tests returned by search query, only the first ${MAX_TESTS_TO_TRIGGER} will be fetched.\n`
      )
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

    test('should return tests from provided suites with overrides', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockImplementation((() => fakeSuites) as any)
      const configOverride = {startUrl}
      const files: string[] = []

      const tests = await runTests.getTestsList(
        fakeApi,
        {...ciConfig, global: configOverride, files},
        mockReporter,
        fakeSuites
      )
      expect(tests).toEqual([
        {config: {startUrl}, id: conf1.tests[0].id, suite: fakeSuites[0].name},
        {config: {startUrl}, id: conf2.tests[0].id, suite: fakeSuites[1].name},
      ])
      expect(getSuitesMock).not.toHaveBeenCalled()
    })

    test('should merge getSuites and user provided suites', async () => {
      const userSuites = [fakeSuites[0]]
      const globSuites = [fakeSuites[1]]

      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockImplementation((() => globSuites) as any)
      const configOverride = {startUrl}
      const files = ['glob']

      const tests = await runTests.getTestsList(
        fakeApi,
        {...ciConfig, global: configOverride, files},
        mockReporter,
        userSuites
      )
      expect(tests).toEqual([
        {config: {startUrl}, id: conf1.tests[0].id, suite: fakeSuites[0].name},
        {config: {startUrl}, id: conf2.tests[0].id, suite: fakeSuites[1].name},
      ])
      expect(getSuitesMock).toHaveBeenCalled()
    })
  })
})
