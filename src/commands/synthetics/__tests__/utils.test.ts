jest.mock('glob')
jest.mock('fs')

import * as fs from 'fs'

import {AxiosError, AxiosRequestConfig, AxiosResponse, default as axios} from 'axios'
import glob from 'glob'

import * as ciHelpers from '../../../helpers/ci'
import {Metadata} from '../../../helpers/interfaces'
import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {CiError} from '../errors'
import {
  ConfigOverride,
  ERRORS,
  ExecutionRule,
  InternalTest,
  PollResult,
  Result,
  Summary,
  Test,
  TriggerConfig,
  TriggerResponse,
} from '../interfaces'
import {Tunnel} from '../tunnel'
import * as utils from '../utils'

import {getApiPollResult, getApiTest, getBrowserResult, mockReporter} from './fixtures'

describe('utils', () => {
  const apiConfiguration = {
    apiKey: '123',
    appKey: '123',
    baseIntakeUrl: 'baseintake',
    baseUrl: 'base',
    proxyOpts: {protocol: 'http'} as ProxyConfiguration,
  }
  const api = apiConstructor(apiConfiguration)

  describe('getSuites', () => {
    const GLOB = 'testGlob'
    const FILES = ['file1', 'file2']
    const FILES_CONTENT = {
      file1: '{"tests":"file1"}',
      file2: '{"tests":"file2"}',
    }

    ;(fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path])
    )
    ;(glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES))

    test('should get suites', async () => {
      const suites = await utils.getSuites(GLOB, mockReporter)
      expect(JSON.stringify(suites)).toBe(
        `[{"name":"file1","content":${FILES_CONTENT.file1}},{"name":"file2","content":${FILES_CONTENT.file2}}]`
      )
    })
  })

  describe('runTest', () => {
    const fakeId = '123-456-789'
    const fakeTrigger = {
      results: [],
      triggered_check_ids: [fakeId],
    }

    afterAll(() => {
      jest.clearAllMocks()
    })

    test('should run test', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        if (e.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      const output = await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(output).toEqual(fakeTrigger)
    })

    test('runTests sends batch metadata', async () => {
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => undefined)

      const payloadMetadataSpy = jest.fn()
      jest.spyOn(axios, 'create').mockImplementation((() => (request: any) => {
        payloadMetadataSpy(request.data.metadata)
        if (request.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(payloadMetadataSpy).toHaveBeenCalledWith(undefined)

      const metadata: Metadata = {
        ci: {job: {name: 'job'}, pipeline: {}, provider: {name: 'jest'}, stage: {}},
        git: {commit: {author: {}, committer: {}, message: 'test'}},
      }
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => metadata)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(payloadMetadataSpy).toHaveBeenCalledWith(metadata)
    })

    test('runTests api call includes trigger app header', async () => {
      jest.spyOn(ciHelpers, 'getCIMetadata').mockImplementation(() => undefined)

      const headersMetadataSpy = jest.fn()
      jest.spyOn(axios, 'create').mockImplementation((() => (request: any) => {
        headersMetadataSpy(request.headers)
        if (request.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)

      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(headersMetadataSpy).toHaveBeenCalledWith(expect.objectContaining({'X-Trigger-App': 'npm_package'}))

      utils.setCiTriggerApp('unit_test')
      await utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      expect(headersMetadataSpy).toHaveBeenCalledWith(expect.objectContaining({'X-Trigger-App': 'unit_test'}))
    })

    test('should run test with publicId from url', async () => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        if (e.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }
      }) as any)
      const output = await utils.runTests(api, [
        {
          executionRule: ExecutionRule.NON_BLOCKING,
          public_id: `http://localhost/synthetics/tests/details/${fakeId}`,
        },
      ])
      expect(output).toEqual(fakeTrigger)
    })

    test('triggerTests throws', async () => {
      const serverError = new Error('Server Error') as AxiosError
      Object.assign(serverError, {
        config: {baseURL: 'baseURL', url: 'url'},
        response: {
          data: {errors: []},
          status: 502,
        },
      })

      const requestMock = jest.fn()
      requestMock.mockImplementation(() => {
        throw serverError
      })
      jest.spyOn(axios, 'create').mockImplementation((() => requestMock) as any)

      await expect(
        utils.runTests(api, [{public_id: fakeId, executionRule: ExecutionRule.NON_BLOCKING}])
      ).rejects.toThrow(/Failed to trigger tests:/)
    })
  })

  describe('getTestsToTrigger', () => {
    const fakeTests: {[id: string]: any} = {
      '123-456-789': {
        config: {request: {url: 'http://example.org/'}},
        name: 'Fake Test',
        public_id: '123-456-789',
        suite: 'Suite 1',
      },
      'ski-ppe-d01': {
        config: {request: {url: 'http://example.org/'}},
        name: 'Skipped Fake Test',
        options: {ci: {executionRule: 'skipped'}},
        public_id: 'ski-ppe-d01',
        suite: 'Suite 3',
      },
    }

    beforeAll(() => {
      const axiosMock = jest.spyOn(axios, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        const publicId = e.url.slice(18)
        if (fakeTests[publicId]) {
          return {data: fakeTests[publicId]}
        }

        const error = new Error('Not found')
        ;((error as unknown) as {status: number}).status = 404
        throw error
      }) as any)
    })

    afterAll(() => {
      jest.clearAllMocks()
    })

    test('only existing tests are returned', async () => {
      const triggerConfigs = [
        {suite: 'Suite 1', config: {}, id: '123-456-789'},
        {suite: 'Suite 2', config: {}, id: '987-654-321'},
        {suite: 'Suite 3', config: {}, id: 'ski-ppe-d01'},
      ]
      const {tests, overriddenTestsToTrigger, summary} = await utils.getTestsToTrigger(
        api,
        triggerConfigs,
        mockReporter
      )

      expect(tests).toStrictEqual([fakeTests['123-456-789']])
      expect(overriddenTestsToTrigger).toStrictEqual([
        {executionRule: ExecutionRule.BLOCKING, public_id: '123-456-789'},
        {executionRule: ExecutionRule.SKIPPED, public_id: 'ski-ppe-d01'},
      ])

      const expectedSummary: Summary = {
        criticalErrors: 0,
        failed: 0,
        failedNonBlocking: 0,
        passed: 0,
        skipped: 1,
        testsNotFound: new Set(['987-654-321']),
        timedOut: 0,
      }
      expect(summary).toEqual(expectedSummary)
    })

    test('no tests triggered throws an error', async () => {
      await expect(utils.getTestsToTrigger(api, [], mockReporter)).rejects.toEqual(new CiError('NO_TESTS_TO_RUN'))
    })
  })

  describe('handleConfig', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi'
      expect(utils.handleConfig({public_id: publicId} as InternalTest, publicId, mockReporter)).toEqual({
        executionRule: ExecutionRule.BLOCKING,
        public_id: publicId,
      })
    })

    test('strictest executionRule is forwarded', () => {
      const expectHandledConfigToBe = (
        expectedExecutionRule: ExecutionRule,
        configExecutionRule?: ExecutionRule,
        testExecutionRule?: ExecutionRule
      ) => {
        const publicId = 'abc-def-ghi'
        const fakeTest = {
          config: {request: {url: 'http://example.org/path'}},
          options: {},
          public_id: publicId,
        } as InternalTest

        if (testExecutionRule) {
          fakeTest.options.ci = {executionRule: testExecutionRule}
        }

        const configOverride = configExecutionRule ? {executionRule: configExecutionRule} : undefined

        expect(utils.getExecutionRule(fakeTest, configOverride)).toBe(expectedExecutionRule)

        const handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)

        expect(handledConfig.public_id).toBe(publicId)
        expect(handledConfig.executionRule).toBe(expectedExecutionRule)
      }

      const BLOCKING = ExecutionRule.BLOCKING
      const NON_BLOCKING = ExecutionRule.NON_BLOCKING
      const SKIPPED = ExecutionRule.SKIPPED

      // No override => BLOCKING
      expectHandledConfigToBe(BLOCKING)

      // CI config overrides only
      expectHandledConfigToBe(BLOCKING, BLOCKING)
      expectHandledConfigToBe(NON_BLOCKING, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, SKIPPED)

      // Test config only
      expectHandledConfigToBe(BLOCKING, undefined, BLOCKING)
      expectHandledConfigToBe(NON_BLOCKING, undefined, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, undefined, SKIPPED)

      // Strictest executionRule is forwarded
      expectHandledConfigToBe(NON_BLOCKING, BLOCKING, NON_BLOCKING)
      expectHandledConfigToBe(SKIPPED, SKIPPED, BLOCKING)
      expectHandledConfigToBe(SKIPPED, NON_BLOCKING, SKIPPED)
      expectHandledConfigToBe(SKIPPED, SKIPPED, NON_BLOCKING)
    })

    test('startUrl template is rendered if correct test type or subtype', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://example.org/path#target'}},
        public_id: publicId,
        type: 'browser',
      } as InternalTest
      const configOverride = {
        startUrl: 'https://{{DOMAIN}}/newPath?oldPath={{ PATHNAME   }}{{HASH}}',
      }
      const expectedUrl = 'https://example.org/newPath?oldPath=/path#target'

      let handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)
      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBe(expectedUrl)

      fakeTest.type = 'api'
      fakeTest.subtype = 'http'

      handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)
      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBe(expectedUrl)

      fakeTest.subtype = 'dns'

      handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)
      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBeUndefined()
    })

    test('startUrl is not parsable', () => {
      const envVars = {...process.env}
      process.env = {CUSTOMVAR: '/newPath'}
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://{{ FAKE_VAR }}/path'}},
        public_id: publicId,
        type: 'browser',
      } as InternalTest
      const configOverride = {
        startUrl: 'https://{{DOMAIN}}/newPath?oldPath={{CUSTOMVAR}}',
      }
      const expectedUrl = 'https://{{DOMAIN}}/newPath?oldPath=/newPath'
      const handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)

      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBe(expectedUrl)
      process.env = envVars
    })

    test('startUrl with empty variable is replaced', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://exmaple.org/path'}},
        public_id: publicId,
        type: 'browser',
      } as InternalTest
      const configOverride = {
        startUrl: 'http://127.0.0.1/newPath{{PARAMS}}',
      }
      const expectedUrl = 'http://127.0.0.1/newPath'
      const handledConfig = utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)

      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBe(expectedUrl)
    })

    test('config overrides are applied', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://example.org/path'}},
        public_id: publicId,
        type: 'browser',
      } as InternalTest
      const configOverride: ConfigOverride = {
        allowInsecureCertificates: true,
        basicAuth: {username: 'user', password: 'password'},
        body: 'body',
        bodyType: 'application/json',
        cookies: 'name=value;',
        defaultStepTimeout: 15,
        deviceIds: ['device_id'],
        executionRule: ExecutionRule.NON_BLOCKING,
        followRedirects: true,
        headers: {'header-name': 'value'},
        locations: ['location'],
        pollingTimeout: 60 * 1000,
        retry: {count: 5, interval: 30},
        startUrl: 'http://127.0.0.1:60/newPath',
        startUrlSubstitutionRegex: '.*',
        tunnel: {host: 'host', id: 'id', privateKey: 'privateKey'},
        variables: {VAR_1: 'value'},
      }

      expect(utils.handleConfig(fakeTest, publicId, mockReporter, configOverride)).toEqual({
        ...configOverride,
        public_id: publicId,
      })
    })
  })

  describe('hasResultPassed', () => {
    test('complete result', () => {
      const result: Result = {
        device: {height: 0, id: 'laptop_large', width: 0},
        duration: 0,
        eventType: 'finished',
        passed: true,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, false, true)).toBeTruthy()
      expect(utils.hasResultPassed(result, true, true)).toBeTruthy()
      result.passed = false
      expect(utils.hasResultPassed(result, false, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, true, true)).toBeFalsy()
    })

    test('result with error', () => {
      const result: Result = {
        device: {height: 0, id: 'laptop_large', width: 0},
        duration: 0,
        errorCode: 'ERRABORTED',
        eventType: 'finished',
        passed: false,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, false, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, true, true)).toBeFalsy()
    })

    test('result with unhealthy result', () => {
      const result: Result = {
        device: {height: 0, id: 'laptop_large', width: 0},
        duration: 0,
        errorCode: 'ERRABORTED',
        eventType: 'finished',
        passed: false,
        startUrl: '',
        stepDetails: [],
        unhealthy: true,
      }
      expect(utils.hasResultPassed(result, false, true)).toBeTruthy()
      expect(utils.hasResultPassed(result, true, true)).toBeFalsy()
    })

    test('result with timeout result', () => {
      const result: Result = {
        device: {height: 0, id: 'laptop_large', width: 0},
        duration: 0,
        error: ERRORS.TIMEOUT,
        eventType: 'finished',
        passed: false,
        startUrl: '',
        stepDetails: [],
      }
      expect(utils.hasResultPassed(result, true, true)).toBeFalsy()
      expect(utils.hasResultPassed(result, true, false)).toBeTruthy()
    })
  })

  test('result with endpoint failure result', () => {
    const result: Result = {
      device: {height: 0, id: 'laptop_large', width: 0},
      duration: 0,
      error: ERRORS.ENDPOINT,
      eventType: 'finished',
      passed: false,
      startUrl: '',
      stepDetails: [],
    }

    expect(utils.hasResultPassed(result, false, true)).toBeTruthy()
    expect(utils.hasResultPassed(result, true, true)).toBeFalsy()
  })

  describe('getResultExecutionRule', () => {
    const cases: [ExecutionRule | undefined, ExecutionRule | undefined, ExecutionRule][] = [
      [undefined, undefined, ExecutionRule.BLOCKING],
      [undefined, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [undefined, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.BLOCKING, undefined, ExecutionRule.BLOCKING],
      [ExecutionRule.BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, undefined, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
    ]

    test.each(cases)(
      'Test execution rule: %s, result execution rule: %s. Expected rule: %s',
      (testRule, resultRule, expectedRule) => {
        const test = getApiTest('abc-def-ghi')
        const pollResult = getApiPollResult('1')

        expect(
          utils.getResultExecutionRule(
            testRule ? {...test, options: {...test.options, ci: {executionRule: testRule}}} : test,
            resultRule ? {...pollResult, enrichment: {config_override: {executionRule: resultRule}}} : pollResult
          )
        ).toEqual(expectedRule)
      }
    )
  })

  describe('getResultOutcome', () => {
    const cases: [boolean, ExecutionRule, utils.TestOrResultOutcome][] = [
      [true, ExecutionRule.BLOCKING, utils.TestOrResultOutcome.Passed],
      [true, ExecutionRule.NON_BLOCKING, utils.TestOrResultOutcome.PassedNonBlocking],
      [false, ExecutionRule.BLOCKING, utils.TestOrResultOutcome.Failed],
      [false, ExecutionRule.NON_BLOCKING, utils.TestOrResultOutcome.FailedNonBlocking],
    ]
    test.each(cases)(
      'Result passed: %s, execution rule: %s. Expected outcome: %s',
      (resultPassed, resultRule, expectedOutcome) => {
        jest.spyOn(utils, 'getResultExecutionRule').mockReturnValue(resultRule)
        jest.spyOn(utils, 'hasResultPassed').mockReturnValue(resultPassed)
        const test = getApiTest('abc-def-ghi')
        const pollResult = getApiPollResult('1')

        expect(utils.getResultOutcome(test, pollResult, true, true)).toEqual(expectedOutcome)
      }
    )
  })

  describe('getTestOutcome', () => {
    const passed = utils.TestOrResultOutcome.Passed
    const passedNonBlocking = utils.TestOrResultOutcome.PassedNonBlocking
    const failed = utils.TestOrResultOutcome.Failed
    const failedNonBlocking = utils.TestOrResultOutcome.FailedNonBlocking

    const cases: [utils.TestOrResultOutcome[], utils.TestOrResultOutcome][] = [
      [[passed, passed, passed], utils.TestOrResultOutcome.Passed],
      [[passed, passedNonBlocking, passed], utils.TestOrResultOutcome.PassedNonBlocking],
      [[passed, failedNonBlocking, passed], utils.TestOrResultOutcome.FailedNonBlocking],
      [[passed, passed, failed], utils.TestOrResultOutcome.Failed],
      [[passed, failedNonBlocking, failed], utils.TestOrResultOutcome.Failed],
    ]
    test.each(cases)('Test results: %s. Expected outcome: %s', (resultOutcomes, expectedOutcome) => {
      let i = 0
      jest.spyOn(utils, 'getResultOutcome').mockImplementation(() => resultOutcomes[i++])
      const test = getApiTest('abc-def-ghi')
      const pollResults = resultOutcomes.map((outcome, index) =>
        getApiPollResult(index.toString(), {passed: outcome === utils.TestOrResultOutcome.Passed})
      )

      expect(utils.getTestOutcome(test, pollResults, true, true)).toEqual(expectedOutcome)
    })
  })

  describe('waitForResults', () => {
    const mockAxiosWithDefaultResult = () => {
      jest.spyOn(axios, 'create').mockImplementation((() => async (r: AxiosRequestConfig) => {
        await utils.wait(100)

        const results = JSON.parse(r.params.result_ids)
          .filter((resultId: string) => resultId !== 'timingOutTest')
          .map((resultId: string) => getPassingPollResult(resultId))

        return {data: {results}}
      }) as any)
    }

    afterAll(() => {
      jest.clearAllMocks()
    })

    const getTestConfig = (publicId = 'abc-def-ghi') => getApiTest(publicId)

    const getPassingPollResult = (resultId: string): PollResult => ({
      check: getTestConfig(),
      dc_id: 42,
      result: getBrowserResult({error: ERRORS.TIMEOUT, passed: false}),
      resultID: resultId,
      timestamp: 0,
    })

    const getTestAndResult = (publicId = 'abc-def-ghi', resultId = '0123456789') => {
      const triggerResult: TriggerResponse = {
        device: 'laptop_large',
        location: 42,
        public_id: publicId,
        result_id: resultId,
      }
      const triggerConfig: TriggerConfig = {
        config: {},
        id: publicId,
        suite: 'Suite 1',
      }

      const passingPollResult: PollResult = getPassingPollResult(resultId)

      return {passingPollResult, triggerConfig, triggerResult}
    }

    test('should poll result ids', async () => {
      mockAxiosWithDefaultResult()
      const {triggerResult, passingPollResult, triggerConfig} = getTestAndResult()
      const waitMock = jest.spyOn(utils, 'wait')
      waitMock.mockImplementation()
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[triggerResult.public_id] = [passingPollResult]

      expect(await utils.waitForResults(api, [triggerResult], 120000, [triggerConfig], undefined, false)).toEqual(
        expectedResults
      )
    })

    test('results should be timed-out if global pollingTimeout is exceeded', async () => {
      const {triggerResult} = getTestAndResult()
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[triggerResult.public_id] = [
        {
          dc_id: triggerResult.location,
          result: getBrowserResult({
            device: {height: 0, id: triggerResult.device, width: 0},
            error: ERRORS.TIMEOUT,
            passed: false,
          }),
          resultID: triggerResult.result_id,
          timestamp: 0,
        },
      ]
      expect(await utils.waitForResults(api, [triggerResult], 0, [], undefined, false)).toEqual(expectedResults)
    })

    test('results should be timeout-ed if test pollingTimeout is exceeded', async () => {
      const {triggerResult} = getTestAndResult()
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[triggerResult.public_id] = [
        {
          dc_id: triggerResult.location,
          result: getBrowserResult({
            device: {height: 0, id: triggerResult.device, width: 0},
            error: ERRORS.TIMEOUT,
            passed: false,
          }),
          resultID: triggerResult.result_id,
          timestamp: 0,
        },
      ]
      const testTriggerConfig = {
        config: {pollingTimeout: 0},
        id: triggerResult.public_id,
        suite: 'Suite 1',
      }
      expect(await utils.waitForResults(api, [triggerResult], 120000, [testTriggerConfig], undefined, false)).toEqual(
        expectedResults
      )
    })

    test('correct number of pass and timeout results', async () => {
      mockAxiosWithDefaultResult()
      const {triggerResult, passingPollResult} = getTestAndResult()
      const waitMock = jest.spyOn(utils, 'wait')
      waitMock.mockImplementation()

      const expectedResults: {[key: string]: PollResult[]} = {}
      const triggerResultPass = triggerResult
      const triggerResultTimeOut = {
        ...triggerResult,
        result_id: 'timingOutTest',
      }
      expectedResults[triggerResult.public_id] = [
        passingPollResult,
        {
          dc_id: triggerResultTimeOut.location,
          result: getBrowserResult({
            device: {height: 0, id: triggerResultTimeOut.device, width: 0},
            error: ERRORS.TIMEOUT,
            passed: false,
          }),
          resultID: triggerResultTimeOut.result_id,
          timestamp: 0,
        },
      ]
      expect(
        await utils.waitForResults(api, [triggerResultPass, triggerResultTimeOut], 2000, [], undefined, false)
      ).toEqual(expectedResults)
    })

    test('tunnel failure', async () => {
      const waitMock = jest.spyOn(utils, 'wait')
      waitMock.mockImplementation()
      const {triggerResult} = getTestAndResult()

      // Fake pollResults to not update results and iterate until the isTunnelConnected is equal to false
      jest
        .spyOn(axios, 'create')
        .mockImplementation((() => async (r: AxiosRequestConfig) => ({data: {results: []}})) as any)

      const mockTunnel = {
        keepAlive: async () => {
          throw new Error('keepAlive failed')
        },
      } as any
      const expectedResults: {[key: string]: PollResult[]} = {
        [triggerResult.public_id]: [
          {
            dc_id: triggerResult.location,
            result: getBrowserResult({
              device: {height: 0, id: triggerResult.device, width: 0},
              error: ERRORS.TUNNEL,
              passed: false,
              tunnel: true,
            }),
            resultID: triggerResult.result_id,
            timestamp: 0,
          },
        ],
      }

      expect(await utils.waitForResults(api, [triggerResult], 2000, [], mockTunnel, true)).toEqual(expectedResults)
      expect(await utils.waitForResults(api, [triggerResult], 2000, [], mockTunnel, false)).toEqual(expectedResults)
    })

    test('pollResults throws', async () => {
      const {triggerResult} = getTestAndResult()
      jest.spyOn(utils, 'wait').mockImplementation()
      const axiosMock = jest.spyOn(axios, 'create')
      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {status: 502} as AxiosResponse
      axiosMock.mockImplementation((() => async (r: AxiosRequestConfig) => {
        throw serverError
      }) as any)

      const mockTunnel = {keepAlive: async () => Promise.reject()} as Tunnel

      const expectedResults: {[key: string]: PollResult[]} = {
        [triggerResult.public_id]: [
          {
            dc_id: triggerResult.location,
            result: getBrowserResult({
              device: {height: 0, id: triggerResult.device, width: 0},
              error: ERRORS.ENDPOINT,
              passed: false,
              tunnel: true,
            }),
            resultID: triggerResult.result_id,
            timestamp: 0,
          },
        ],
      }

      expect(await utils.waitForResults(api, [triggerResult], 2000, [], mockTunnel, false)).toEqual(expectedResults)
      await expect(utils.waitForResults(api, [triggerResult], 2000, [], mockTunnel, true)).rejects.toThrow()
    })
  })

  test('getStrictestExecutionRule', () => {
    const BLOCKING = ExecutionRule.BLOCKING
    const NON_BLOCKING = ExecutionRule.NON_BLOCKING
    const SKIPPED = ExecutionRule.SKIPPED
    expect(utils.getStrictestExecutionRule(BLOCKING, NON_BLOCKING)).toBe(NON_BLOCKING)
    expect(utils.getStrictestExecutionRule(NON_BLOCKING, BLOCKING)).toBe(NON_BLOCKING)
    expect(utils.getStrictestExecutionRule(NON_BLOCKING, SKIPPED)).toBe(SKIPPED)
    expect(utils.getStrictestExecutionRule(BLOCKING, undefined)).toBe(BLOCKING)
    expect(utils.getStrictestExecutionRule(SKIPPED, undefined)).toBe(SKIPPED)
  })

  describe('retry', () => {
    test('retry works fine', async () => {
      const result = await utils.retry(
        async () => 42,
        () => 1
      )
      expect(result).toBe(42)
    })

    test('retry works fine after some retries', async () => {
      let counter = 0
      const start = +new Date()
      const result = await utils.retry(
        async () => {
          if (counter === 3) {
            return 42
          }
          counter += 1
          throw new Error('')
        },
        (retries: number) => 100 * (retries + 1)
      )
      const end = +new Date()
      const approximateWait = 100 + 100 * 2 + 100 * 3

      expect(result).toBe(42)
      expect(counter).toBe(3)
      expect(end - start - approximateWait < 50).toBeTruthy()
    })

    test('retry rethrows after some retries', async () => {
      let counter = 0

      await expect(
        utils.retry(
          async () => {
            counter += 1
            throw new Error('FAILURE')
          },
          (retries: number) => {
            if (retries < 2) {
              return 1
            }
          }
        )
      ).rejects.toThrowError('FAILURE')
      expect(counter).toBe(3)
    })
  })

  test('parseVariablesFromCli', () => {
    const mockLogFunction = (message: string) => undefined
    expect(utils.parseVariablesFromCli(['TEST=42'], mockLogFunction)).toEqual({TEST: '42'})
    expect(utils.parseVariablesFromCli(['TEST=42 with some spaces'], mockLogFunction)).toEqual({
      TEST: '42 with some spaces',
    })
    expect(utils.parseVariablesFromCli(['TEST=42=43=44'], mockLogFunction)).toEqual({TEST: '42=43=44'})
    expect(utils.parseVariablesFromCli(['TEST='], mockLogFunction)).toEqual({TEST: ''})
    expect(utils.parseVariablesFromCli([''], mockLogFunction)).toBeUndefined()
    expect(utils.parseVariablesFromCli(undefined, mockLogFunction)).toBeUndefined()
  })
})
