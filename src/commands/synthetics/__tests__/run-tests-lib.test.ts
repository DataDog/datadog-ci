import fs from 'fs'

import * as ciUtils from '../../../helpers/utils'

import * as api from '../api'
import {CiError, CriticalCiErrorCode, CriticalError} from '../errors'
import {ExecutionRule, RunTestsCommandConfig, Summary, UserConfigOverride} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {JUnitReporter} from '../reporters/junit'
import {MAX_TESTS_TO_TRIGGER} from '../run-tests-command'
import * as runTests from '../run-tests-lib'
import {Tunnel} from '../tunnel'
import * as utils from '../utils'

import {
  ciConfig,
  getApiResult,
  getApiTest,
  getAxiosHttpError,
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

  describe('executeTests', () => {
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
    ] as [string, Partial<RunTestsCommandConfig>, UserConfigOverride][])(
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
        ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
        expect(getTestsToTriggersMock).toHaveBeenCalledWith(
          apiHelper,
          expect.arrayContaining([
            expect.objectContaining({id: 'public-id-1', config: expectedOverriddenConfig}),
            expect.objectContaining({id: 'public-id-2', config: expectedOverriddenConfig}),
          ]),
          expect.anything(),
          false,
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
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything(),
        false,
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
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything(),
        false,
        false,
        true
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
        const apiHelper = {
          searchTests: jest.fn(() => {
            throw getAxiosHttpError(status, {message: 'Server Error'})
          }),
        }
        jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, testSearchQuery: 'a-search-query', tunnel: true})
        ).rejects.toThrow(new CriticalError(error, 'Server Error'))
      })

      test(`getTestsToTrigger throws - ${status}`, async () => {
        const apiHelper = {
          getTest: jest.fn(() => {
            throw getAxiosHttpError(status, {errors: ['Bad Gateway']})
          }),
        }
        jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
        await expect(
          runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1'], tunnel: true})
        ).rejects.toThrow(
          new CriticalError(
            error,
            'Failed to get test: query on https://app.datadoghq.com/example returned: "Bad Gateway"\n'
          )
        )
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

      const apiHelper = {
        getTunnelPresignedURL: jest.fn(() => {
          throw getAxiosHttpError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toThrow(new CriticalError('UNAVAILABLE_TUNNEL_CONFIG', 'Server Error'))
    })

    test('getMobileApplicationPresignedURL throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(utils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      // use /dev/null to create a valid empty fs.ReadStream
      const testStream = fs.createReadStream('/dev/null')
      jest.spyOn(fs, 'createReadStream').mockReturnValue(testStream)

      const apiHelper = {
        getMobileApplicationPresignedURL: jest.fn(() => {
          throw getAxiosHttpError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toThrow('Failed to get presigned URL: could not query https://app.datadoghq.com/example')
    })

    test('uploadMobileApplication throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(utils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      // use /dev/null to create a valid empty fs.ReadStream
      const testStream = fs.createReadStream('/dev/null')
      jest.spyOn(fs, 'createReadStream').mockReturnValue(testStream)

      jest.spyOn(fs.promises, 'readFile').mockImplementation(async () => Buffer.from('aa'))

      const apiHelper = {
        getMobileApplicationPresignedURL: jest.fn(() => MOBILE_PRESIGNED_URL_PAYLOAD),
        uploadMobileApplication: jest.fn(() => {
          throw getAxiosHttpError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          global: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toThrow('Failed to upload mobile application: could not query https://app.datadoghq.com/example')
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

      const apiHelper = {
        getTunnelPresignedURL: () => ({url: 'url'}),
        triggerTests: jest.fn(() => {
          throw getAxiosHttpError(502, {errors: ['Bad Gateway']})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {...ciConfig, publicIds: ['public-id-1', 'public-id-2'], tunnel: true})
      ).rejects.toThrow(
        new CriticalError(
          'TRIGGER_TESTS_FAILED',
          '[] Failed to trigger tests: query on https://app.datadoghq.com/example returned: "Bad Gateway"\n'
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

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: jest.fn(() => {
          throw getAxiosHttpError(502, {errors: ['Bad Gateway']})
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
      ).rejects.toThrow(
        new CriticalError(
          'POLL_RESULTS_FAILED',
          'Failed to poll results: query on https://app.datadoghq.com/example returned: "Bad Gateway"\n'
        )
      )
      expect(stopTunnelSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('execute', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
      jest.spyOn(api, 'getApiHelper').mockImplementation(
        () =>
          ({
            getSyntheticsOrgSettings: () => ({
              onDemandConcurrencyCap: 1,
            }),
          } as any)
      )
      jest.spyOn(runTests, 'executeTests').mockReturnValue(Promise.resolve({results: [], summary: {} as Summary}))
      jest.spyOn(utils, 'renderResults').mockImplementation(jest.fn())
    })

    test('should call executeTests and renderResults', async () => {
      await runTests.execute({}, {})
      expect(runTests.executeTests).toHaveBeenCalled()
      expect(utils.renderResults).toHaveBeenCalled()
    })

    test('should extend config', async () => {
      const runConfig = {apiKey: 'apiKey', appKey: 'appKey'}
      await runTests.execute(runConfig, {})
      expect(runTests.executeTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining(runConfig),
        undefined
      )
    })

    test('should bypass files if suite is passed', async () => {
      const suites = [{content: {tests: []}}]
      await runTests.execute({}, {suites})
      expect(runTests.executeTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({files: []}),
        suites
      )
    })

    describe('reporters', () => {
      beforeEach(() => {
        jest.spyOn(utils, 'getReporter').mockImplementation(jest.fn())
      })

      test('should use default reporter with empty config', async () => {
        await runTests.execute({}, {})
        expect(utils.getReporter).toHaveBeenCalledWith(expect.arrayContaining([expect.any(DefaultReporter)]))
      })

      test('should use custom reporters', async () => {
        const CustomReporter = {}
        await runTests.execute({}, {reporters: ['junit', CustomReporter]})
        expect(utils.getReporter).toHaveBeenCalledWith(
          expect.arrayContaining([expect.any(JUnitReporter), CustomReporter])
        )
      })
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
