import fs from 'fs'
import os from 'os'

import {getAxiosError} from '../../../helpers/__tests__/testing-tools'
import * as ciUtils from '../../../helpers/utils'

import * as api from '../api'
import * as batchUtils from '../batch'
import {CiError, CriticalError} from '../errors'
import {ExecutionRule, Suite, Summary} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {JUnitReporter} from '../reporters/junit'
import * as appUploadReporterModule from '../reporters/mobile/app-upload'
import * as runTests from '../run-tests-lib'
import * as testUtils from '../test'
import {Tunnel} from '../tunnel'
import * as internalUtils from '../utils/internal'
import * as utils from '../utils/public'

import {
  ciConfig,
  getApiResult,
  getApiTest,
  getMobileTest,
  MOBILE_PRESIGNED_URLS_PAYLOAD,
  mockReporter,
  mockServerTriggerResponse,
  mockTriggerInfo,
} from './fixtures'

describe('run-test', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    process.env = {}
  })

  describe('executeTests', () => {
    test('should apply config override for tests triggered by public id', async () => {
      const getTestsToTriggersMock = jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [],
        })
      )
      jest.spyOn(batchUtils, 'runTests').mockImplementation()

      const startUrl = '{{PROTOCOL}}//myhost{{PATHNAME}}{{PARAMS}}'
      const locations = ['location1', 'location2']
      const userConfigOverride = {locations, startUrl}

      const apiHelper = {}

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => ({} as any))

      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          defaultTestOverrides: userConfigOverride,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
        })
      ).rejects.toThrow()
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'aaa-aaa-aaa', testOverrides: userConfigOverride}),
          expect.objectContaining({id: 'bbb-bbb-bbb', testOverrides: userConfigOverride}),
        ]),
        expect.anything(),
        false,
        false,
        false
      )
    })

    test('Use appropriate list of locations for tests triggered by public id', async () => {
      const getTestsToTriggersMock = jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
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
          defaultTestOverrides: {locations: ['defaultTestOverrides-location-1']},
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
        })
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'aaa-aaa-aaa', testOverrides: {locations: ['defaultTestOverrides-location-1']}}),
          expect.objectContaining({id: 'bbb-bbb-bbb', testOverrides: {locations: ['defaultTestOverrides-location-1']}}),
        ]),
        expect.anything(),
        false,
        false,
        false
      )
    })

    test('should not wait for `skipped` only tests batch results', async () => {
      const getTestsToTriggersMock = jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
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
          defaultTestOverrides: configOverride,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
        })
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'aaa-aaa-aaa', testOverrides: configOverride}),
          expect.objectContaining({id: 'bbb-bbb-bbb', testOverrides: configOverride}),
        ]),
        expect.anything(),
        false,
        false,
        false
      )
    })

    test('should not open tunnel if no test to run', async () => {
      const getTestsToTriggersMock = jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
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
          defaultTestOverrides: configOverride,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
          tunnel: true,
        })
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'aaa-aaa-aaa', testOverrides: configOverride}),
          expect.objectContaining({id: 'bbb-bbb-bbb', testOverrides: configOverride}),
        ]),
        expect.anything(),
        false,
        false,
        true
      )
      expect(apiHelper.getTunnelPresignedURL).not.toHaveBeenCalled()
    })

    test('open and close tunnel for successful runs', async () => {
      jest.spyOn(internalUtils, 'wait').mockImplementation(() => new Promise((res) => setTimeout(res, 10)))
      const startTunnelSpy = jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

      jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: '123-456-789'} as any],
        })
      )

      jest.spyOn(batchUtils, 'runTests').mockResolvedValue(mockTriggerInfo)

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: () => [getApiResult('1', getApiTest())],
        triggerTests: () => mockServerTriggerResponse,
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

    test(`403 in getTestsList throws AUTHORIZATION_ERROR`, async () => {
      const apiHelper = {
        searchTests: jest.fn(() => {
          throw getAxiosError(403, {message: 'Some message'})
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          testSearchQuery: 'a-search-query',
        })
      ).rejects.toThrow(new CriticalError('AUTHORIZATION_ERROR', 'Some message'))
    })

    test(`502 in getTestsList throws UNAVAILABLE_TEST_CONFIG`, async () => {
      const apiHelper = {
        searchTests: jest.fn(() => {
          throw getAxiosError(502, {message: 'Some message'})
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          testSearchQuery: 'a-search-query',
        })
      ).rejects.toThrow(new CriticalError('UNAVAILABLE_TEST_CONFIG', 'Some message'))
    })

    test(`403 in getTestsToTrigger is not a critical error`, async () => {
      const apiHelper = {
        getTest: jest.fn(() => {
          throw getAxiosError(403, {errors: ['Some message']})
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          publicIds: ['aaa-aaa-aaa'],
        })
      ).rejects.toThrow(new CiError('NO_TESTS_TO_RUN'))
    })

    test(`502 in getTestsToTrigger throws UNAVAILABLE_TEST_CONFIG`, async () => {
      const apiHelper = {
        getTest: jest.fn(() => {
          throw getAxiosError(502, {errors: ['Some message']})
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          publicIds: ['aaa-aaa-aaa'],
        })
      ).rejects.toThrow(
        new CriticalError(
          'TRIGGER_TESTS_FAILED',
          'Failed to get test: query on https://app.datadoghq.com/example returned: "Some message"\n'
        )
      )
    })

    test('getTunnelPresignedURL throws', async () => {
      jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const apiHelper = {
        getTunnelPresignedURL: jest.fn(() => {
          throw getAxiosError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
          tunnel: true,
        })
      ).rejects.toThrow(new CriticalError('UNAVAILABLE_TUNNEL_CONFIG', 'Server Error'))
    })

    test('getMobileApplicationPresignedURLs throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(testUtils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      // use /dev/null to create a valid empty fs.ReadStream
      const testStream = fs.createReadStream(os.devNull)
      jest.spyOn(fs, 'createReadStream').mockReturnValue(testStream)

      const {AppUploadReporter} = jest.requireActual<typeof appUploadReporterModule>('../reporters/mobile/app-upload')
      jest
        .spyOn(appUploadReporterModule, 'AppUploadReporter')
        .mockImplementation(() => new AppUploadReporter({stdout: {write: jest.fn()}} as any))

      const apiHelper = {
        getMobileApplicationPresignedURLs: jest.fn(() => {
          throw getAxiosError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          defaultTestOverrides: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toThrow('Failed to get presigned URL: could not query https://app.datadoghq.com/example')
    })

    test('uploadMobileApplicationPart throws', async () => {
      const mobileTest = getMobileTest()
      jest.spyOn(testUtils, 'getTestAndOverrideConfig').mockImplementation(async () =>
        Promise.resolve({
          overriddenConfig: {executionRule: ExecutionRule.NON_BLOCKING, public_id: mobileTest.public_id},
          test: mobileTest,
        })
      )

      // use /dev/null to create a valid empty fs.ReadStream
      const testStream = fs.createReadStream(os.devNull)
      jest.spyOn(fs, 'createReadStream').mockReturnValue(testStream)

      const {AppUploadReporter} = jest.requireActual<typeof appUploadReporterModule>('../reporters/mobile/app-upload')
      jest
        .spyOn(appUploadReporterModule, 'AppUploadReporter')
        .mockImplementation(() => new AppUploadReporter({stdout: {write: jest.fn()}} as any))

      jest.spyOn(fs.promises, 'readFile').mockImplementation(async () => Buffer.from('aa'))

      const apiHelper = {
        getMobileApplicationPresignedURLs: jest.fn(() => MOBILE_PRESIGNED_URLS_PAYLOAD),
        uploadMobileApplicationPart: jest.fn(() => {
          throw getAxiosError(502, {message: 'Server Error'})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          defaultTestOverrides: {mobileApplicationVersionFilePath: 'filePath'},
          publicIds: [mobileTest.public_id],
        })
      ).rejects.toThrow('Failed to upload mobile application: could not query https://app.datadoghq.com/example')
    })

    test('runTests throws', async () => {
      jest
        .spyOn(Tunnel.prototype, 'start')
        .mockImplementation(async () => ({host: 'host', id: 'id', privateKey: 'key'}))
      const stopTunnelSpy = jest.spyOn(Tunnel.prototype, 'stop')

      jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
        })
      )

      const apiHelper = {
        getTunnelPresignedURL: () => ({url: 'url'}),
        triggerTests: jest.fn(() => {
          throw getAxiosError(502, {errors: ['Bad Gateway']})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
          tunnel: true,
        })
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
      jest.spyOn(testUtils, 'getTestsToTrigger').mockResolvedValue({
        initialSummary: utils.createInitialSummary(),
        overriddenTestsToTrigger: [],
        tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'publicId'} as any],
      })
      jest.spyOn(batchUtils, 'runTests').mockResolvedValue({...mockTriggerInfo, locations: [location]})

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: jest.fn(() => {
          throw getAxiosError(502, {errors: ['Bad Gateway']})
        }),
      }

      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      await expect(
        runTests.executeTests(mockReporter, {
          ...ciConfig,
          failOnCriticalErrors: true,
          publicIds: ['aaa-aaa-aaa', 'bbb-bbb-bbb'],
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

    test('log when selective rerun is rate-limited', async () => {
      jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'aaa-aaa-aaa'} as any],
        })
      )
      jest.spyOn(batchUtils, 'runTests').mockImplementation(async () => ({
        batchId: 'bid',
        locations: [],
        selectiveRerunRateLimited: true,
        testsNotAuthorized: new Set(),
      }))

      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: () => [getApiResult('1', getApiTest())],
        triggerTests: () => mockServerTriggerResponse,
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await runTests.executeTests(mockReporter, {
        ...ciConfig,
        publicIds: ['aaa-aaa-aaa'],
        selectiveRerun: true,
      })

      expect(mockReporter.error).toHaveBeenCalledWith(
        'The selective rerun feature was rate-limited. All tests will be re-run.\n\n'
      )
    })

    test('selective rerun defaults to undefined', async () => {
      jest.spyOn(testUtils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          initialSummary: utils.createInitialSummary(),
          overriddenTestsToTrigger: [],
          tests: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'aaa-aaa-aaa'} as any],
        })
      )

      const triggerTestsSpy = jest.fn(() => mockServerTriggerResponse)
      const apiHelper = {
        getBatch: () => ({results: []}),
        getTunnelPresignedURL: () => ({url: 'url'}),
        pollResults: () => [getApiResult('1', getApiTest())],
        triggerTests: triggerTestsSpy,
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await runTests.executeTests(mockReporter, {
        ...ciConfig,
        publicIds: ['aaa-aaa-aaa'],
        // no `selectiveRerun` provided
      })

      expect(triggerTestsSpy).toHaveBeenCalledWith({
        tests: [],
        options: {
          batch_timeout: ciConfig.batchTimeout,
          selective_rerun: undefined,
        },
      })
    })
  })

  describe('executeWithDetails', () => {
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
      await runTests.executeWithDetails({}, {})
      expect(runTests.executeTests).toHaveBeenCalled()
      expect(utils.renderResults).toHaveBeenCalled()
    })

    test('should extend config', async () => {
      const runConfig = {apiKey: 'apiKey', appKey: 'appKey'}
      await runTests.executeWithDetails(runConfig, {})
      expect(runTests.executeTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining(runConfig),
        undefined
      )
    })

    test('should bypass files if suite is passed', async () => {
      const suites = [{content: {tests: []}}]
      await runTests.executeWithDetails({}, {suites})
      expect(runTests.executeTests).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({files: []}),
        suites
      )
    })

    test('should return values returned by executeTests, and an exitCode', async () => {
      const returnValue = await runTests.executeWithDetails({}, {})
      expect(returnValue.results).toBeDefined()
      expect(returnValue.summary).toBeDefined()
      expect(returnValue.exitCode).toBeDefined()
    })

    describe('reporters', () => {
      beforeEach(() => {
        jest.spyOn(utils, 'getReporter').mockImplementation(jest.fn())
      })

      test('should use default reporter with empty config', async () => {
        await runTests.executeWithDetails({}, {})
        expect(utils.getReporter).toHaveBeenCalledWith(expect.arrayContaining([expect.any(DefaultReporter)]))
      })

      test('should use custom reporters', async () => {
        const CustomReporter = {}
        await runTests.executeWithDetails({}, {reporters: ['junit', CustomReporter]})
        expect(utils.getReporter).toHaveBeenCalledWith(
          expect.arrayContaining([expect.any(JUnitReporter), CustomReporter])
        )
      })
    })
  })

  describe('execute', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
      jest
        .spyOn(runTests, 'executeWithDetails')
        .mockReturnValue(Promise.resolve({results: [], summary: {} as Summary, exitCode: 0}))
    })

    test('should call executeWithDetails', async () => {
      await runTests.execute({}, {})
      expect(runTests.executeWithDetails).toHaveBeenCalled()
    })

    test('should return the exitCode returned by executeWithDetails', async () => {
      const returnValue = await runTests.execute({}, {})
      expect(returnValue).toBe(0)
    })
  })

  describe('getTriggerConfigs', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    const startUrl = 'fakeUrl'
    const locations = ['aws:ap-northeast-1']
    const conf1 = {
      tests: [{testOverrides: {deviceIds: ['chrome.laptop_large']}, id: 'abc-def-ghi'}],
    }
    const conf2 = {
      tests: [{testOverrides: {startUrl: 'someOtherFakeUrl'}, id: 'jkl-mno-pqr'}],
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
    const fakeApi = {
      searchTests: () => ({
        tests: [
          {
            public_id: 'stu-vwx-yza',
          },
        ],
      }),
    } as any

    test('should extend global config and execute all tests from test config files when no clue what to run', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockResolvedValue(fakeSuites)
      const defaultTestOverrides = {locations, startUrl}

      await expect(
        runTests.getTriggerConfigs(fakeApi, {...ciConfig, defaultTestOverrides}, mockReporter)
      ).resolves.toEqual([
        {
          testOverrides: {deviceIds: ['chrome.laptop_large'], startUrl, locations},
          id: 'abc-def-ghi',
          suite: 'Suite 1',
        },
        {
          testOverrides: {startUrl: 'someOtherFakeUrl', locations},
          id: 'jkl-mno-pqr',
          suite: 'Suite 2',
        },
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(1)
      expect(getSuitesMock).toHaveBeenCalledWith('{,!(node_modules)/**/}*.synthetics.json', mockReporter)
    })

    test('should override and execute only publicIds that were defined in the global config', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites')
      const defaultTestOverrides = {locations, startUrl}

      await expect(
        runTests.getTriggerConfigs(
          fakeApi,
          {
            ...ciConfig,
            defaultTestOverrides,
            publicIds: ['abc-def-ghi', '123-456-789'],
          },
          mockReporter
        )
      ).resolves.toEqual([
        {
          testOverrides: {startUrl, locations},
          id: 'abc-def-ghi',
        },
        {
          testOverrides: {startUrl, locations},
          id: '123-456-789',
        },
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(0)
    })

    test('should override and execute only publicIds that were defined in the global config and use given globs', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockResolvedValue(fakeSuites)
      const defaultTestOverrides = {locations, startUrl}
      const files = ['glob']

      await expect(
        runTests.getTriggerConfigs(
          fakeApi,
          {
            ...ciConfig,
            defaultTestOverrides,
            files,
            publicIds: ['abc-def-ghi'],
          },
          mockReporter
        )
      ).resolves.toEqual([
        {
          testOverrides: {startUrl, locations, deviceIds: ['chrome.laptop_large']},
          id: 'abc-def-ghi',
          suite: 'Suite 1',
        },
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(1)
      expect(getSuitesMock).toHaveBeenCalledWith('glob', mockReporter)
    })

    test('should search tests and extend global config', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites')
      const defaultTestOverrides = {locations, startUrl}
      const searchQuery = 'fake search'

      await expect(
        runTests.getTriggerConfigs(
          fakeApi,
          {
            ...ciConfig,
            defaultTestOverrides,
            testSearchQuery: searchQuery,
          },
          mockReporter
        )
      ).resolves.toEqual([
        {
          testOverrides: {locations, startUrl},
          id: 'stu-vwx-yza',
          suite: 'Query: fake search',
        },
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(0)
    })

    test('should not use testSearchQuery if global config has defined publicIds', async () => {
      const defaultTestOverrides = {startUrl}
      const searchQuery = 'fake search'

      await expect(
        runTests.getTriggerConfigs(
          fakeApi,
          {...ciConfig, defaultTestOverrides, publicIds: ['abc-def-ghi'], testSearchQuery: searchQuery},
          mockReporter
        )
      ).resolves.toEqual([
        {
          testOverrides: {startUrl},
          id: 'abc-def-ghi',
        },
      ])
    })

    test('should search tests with testSearchQuery and use given globs', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockResolvedValue(fakeSuites)

      const defaultTestOverrides = {startUrl}
      const searchQuery = 'fake search'
      const files = ['glob']

      await expect(
        runTests.getTriggerConfigs(
          fakeApi,
          {
            ...ciConfig,
            defaultTestOverrides,
            files,
            testSearchQuery: searchQuery,
          },
          mockReporter
        )
      ).resolves.toEqual([
        {
          testOverrides: {startUrl},
          id: 'stu-vwx-yza',
          suite: 'Query: fake search',
        },
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(1)
      expect(getSuitesMock).toHaveBeenCalledWith('glob', mockReporter)
    })

    test('should use given globs to get tests list', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockResolvedValue(fakeSuites)
      const defaultTestOverrides = {startUrl}
      const files = ['new glob', 'another one']

      await runTests.getTriggerConfigs(fakeApi, {...ciConfig, defaultTestOverrides, files}, mockReporter)

      expect(getSuitesMock).toHaveBeenCalledTimes(2)
      expect(getSuitesMock).toHaveBeenCalledWith('new glob', mockReporter)
      expect(getSuitesMock).toHaveBeenCalledWith('another one', mockReporter)
    })

    test('should return tests from provided suites with overrides', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites')
      const defaultTestOverrides = {startUrl}
      const files: string[] = []

      const tests = await runTests.getTriggerConfigs(
        fakeApi,
        {...ciConfig, defaultTestOverrides, files},
        mockReporter,
        fakeSuites
      )

      expect(tests).toEqual([
        {
          testOverrides: {deviceIds: ['chrome.laptop_large'], startUrl},
          id: conf1.tests[0].id,
          suite: fakeSuites[0].name,
        },
        {testOverrides: {startUrl: 'someOtherFakeUrl'}, id: conf2.tests[0].id, suite: fakeSuites[1].name},
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(0)
    })

    test('should merge getSuites and user provided suites', async () => {
      const userSuites = [fakeSuites[0]]
      const globSuites = [fakeSuites[1]]

      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockResolvedValue(globSuites)
      const defaultTestOverrides = {startUrl}
      const files = ['glob']

      const tests = await runTests.getTriggerConfigs(
        fakeApi,
        {...ciConfig, defaultTestOverrides, files},
        mockReporter,
        userSuites
      )

      expect(tests).toEqual([
        {
          testOverrides: {deviceIds: ['chrome.laptop_large'], startUrl},
          id: conf1.tests[0].id,
          suite: fakeSuites[0].name,
        },
        {testOverrides: {startUrl: 'someOtherFakeUrl'}, id: conf2.tests[0].id, suite: fakeSuites[1].name},
      ])

      expect(getSuitesMock).toHaveBeenCalledTimes(1)
      expect(getSuitesMock).toHaveBeenCalledWith('glob', mockReporter)
    })

    test('should handle test configurations with the same test ID correctly', async () => {
      const suite: Suite = {
        name: 'Suite with duplicate IDs',
        content: {
          tests: [
            {
              id: 'abc-abc-abc',
              testOverrides: {
                allowInsecureCertificates: true,
                basicAuth: {username: 'test', password: 'test'},
                body: '{"fakeContent":true}',
                bodyType: 'application/json',
                cookies: 'name1=value1;name2=value2;',
                setCookies: 'name1=value1 \n name2=value2; Secure',
                defaultStepTimeout: 15,
                deviceIds: ['chrome.laptop_large'],
                executionRule: ExecutionRule.NON_BLOCKING,
                followRedirects: true,
                headers: {NEW_HEADER: 'NEW VALUE'},
                locations: ['aws:us-east-1'],
                mobileApplicationVersion: '01234567-8888-9999-abcd-efffffffffff',
                mobileApplicationVersionFilePath: 'path/to/application.apk',
                retry: {count: 2, interval: 300},
                testTimeout: 300,
                variables: {MY_VARIABLE: 'new title'},
              },
            },
            {
              id: 'abc-abc-abc',
              testOverrides: {
                executionRule: ExecutionRule.SKIPPED,
              },
            },
          ],
        },
      }
      jest.spyOn(utils, 'getSuites').mockResolvedValue([suite])

      const defaultTestOverrides = {locations: ['aws:us-east-1'], startUrl: 'fakeUrl'}

      await expect(
        runTests.getTriggerConfigs(fakeApi, {...ciConfig, defaultTestOverrides}, mockReporter)
      ).resolves.toEqual([
        {
          testOverrides: {
            allowInsecureCertificates: true,
            basicAuth: {username: 'test', password: 'test'},
            body: '{"fakeContent":true}',
            bodyType: 'application/json',
            cookies: 'name1=value1;name2=value2;',
            setCookies: 'name1=value1 \n name2=value2; Secure',
            defaultStepTimeout: 15,
            deviceIds: ['chrome.laptop_large'],
            executionRule: 'non_blocking',
            followRedirects: true,
            headers: {NEW_HEADER: 'NEW VALUE'},
            locations: ['aws:us-east-1'],
            mobileApplicationVersion: '01234567-8888-9999-abcd-efffffffffff',
            mobileApplicationVersionFilePath: 'path/to/application.apk',
            retry: {count: 2, interval: 300},
            testTimeout: 300,
            variables: {MY_VARIABLE: 'new title'},
            startUrl: 'fakeUrl',
          },
          id: 'abc-abc-abc',
          suite: 'Suite with duplicate IDs',
        },
        {
          testOverrides: {
            executionRule: 'skipped',
            startUrl: 'fakeUrl',
            locations: ['aws:us-east-1'],
          },
          id: 'abc-abc-abc',
          suite: 'Suite with duplicate IDs',
        },
      ])
    })

    test('should handle local test definitions', async () => {
      const localTestDefinition = getApiTest('bbb-bbb-bbb')
      const suite: Suite = {
        name: 'Suite with local test definitions',
        content: {
          tests: [
            {
              id: 'aaa-aaa-aaa',
              testOverrides: {
                startUrl: 'fakeUrl',
              },
            },
            {
              localTestDefinition,
              testOverrides: {
                startUrl: 'fakeUrl',
              },
            },
          ],
        },
      }
      jest.spyOn(utils, 'getSuites').mockResolvedValue([suite])

      await expect(runTests.getTriggerConfigs(fakeApi, ciConfig, mockReporter)).resolves.toEqual([
        {
          id: 'aaa-aaa-aaa',
          suite: 'Suite with local test definitions',
          testOverrides: {startUrl: 'fakeUrl'},
        },
        {
          localTestDefinition,
          suite: 'Suite with local test definitions',
          testOverrides: {startUrl: 'fakeUrl'},
        },
      ])
    })

    test('should handle local test definitions selected with publicIds', async () => {
      const localTestDefinition = getApiTest('bbb-bbb-bbb')
      const suite: Suite = {
        name: 'Suite with local test definitions',
        content: {
          tests: [
            {
              id: 'aaa-aaa-aaa',
              testOverrides: {
                startUrl: 'fakeUrl',
              },
            },
            {
              localTestDefinition,
              testOverrides: {
                startUrl: 'fakeUrl',
              },
            },
          ],
        },
      }
      jest.spyOn(utils, 'getSuites').mockResolvedValue([suite])

      await expect(
        runTests.getTriggerConfigs(fakeApi, {...ciConfig, files: ['glob'], publicIds: ['bbb-bbb-bbb']}, mockReporter)
      ).resolves.toEqual([
        {
          localTestDefinition,
          suite: 'Suite with local test definitions',
          testOverrides: {startUrl: 'fakeUrl'},
        },
      ])
    })
  })
})
