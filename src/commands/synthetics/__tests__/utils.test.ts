jest.mock('glob')
jest.mock('fs')

import * as fs from 'fs'

import {AxiosError, AxiosRequestConfig, AxiosResponse, default as axios} from 'axios'
import glob from 'glob'

import {ProxyConfiguration} from '../../../helpers/utils'

import {apiConstructor} from '../api'
import {ConfigOverride, ERRORS, ExecutionRule, InternalTest, PollResult, Result, Summary} from '../interfaces'
import {Tunnel} from '../tunnel'
import * as utils from '../utils'

import {getApiTest, getBrowserResult, mockReporter} from './fixtures'

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
        passed: 0,
        skipped: 1,
        testsNotFound: new Set(['987-654-321']),
        timedOut: 0,
      }
      expect(summary).toEqual(expectedSummary)
    })

    test('no tests triggered throws an error', async () => {
      await expect(utils.getTestsToTrigger(api, [], mockReporter)).rejects.toEqual(new Error('No tests to trigger'))
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

  test('hasTestSucceeded', () => {
    const testConfiguration = getApiTest('abc-def-ghi')
    const passingResult = getBrowserResult()
    const passingPollResult = {
      check: testConfiguration,
      dc_id: 42,
      result: passingResult,
      resultID: '0123456789',
      timestamp: 0,
    }
    const failingPollResult = {
      check: testConfiguration,
      dc_id: 42,
      result: {...passingResult, passed: false},
      resultID: '0123456789',
      timestamp: 0,
    }
    const unhealthyPollResult = {
      check: testConfiguration,
      dc_id: 42,
      result: {...passingResult, passed: false, unhealthy: true},
      resultID: '0123456789',
      timestamp: 0,
    }
    const endpointFailurePollResult = {
      check: testConfiguration,
      dc_id: 42,
      result: {...passingResult, passed: false, error: ERRORS.ENDPOINT},
      resultID: '0123456789',
      timestamp: 0,
    }
    const timeoutPollResult = {
      check: testConfiguration,
      dc_id: 42,
      result: {...passingResult, passed: false, error: ERRORS.TIMEOUT},
      resultID: '0123456789',
      timestamp: 0,
    }

    expect(utils.hasTestSucceeded([passingPollResult, failingPollResult], false, true)).toBeFalsy()
    expect(utils.hasTestSucceeded([passingPollResult, unhealthyPollResult], true, true)).toBeFalsy()
    expect(utils.hasTestSucceeded([passingPollResult, unhealthyPollResult], false, true)).toBeTruthy()
    expect(utils.hasTestSucceeded([passingPollResult, endpointFailurePollResult], true, true)).toBeFalsy()
    expect(utils.hasTestSucceeded([passingPollResult, endpointFailurePollResult], false, true)).toBeTruthy()
    expect(utils.hasTestSucceeded([passingPollResult, passingPollResult], false, true)).toBeTruthy()
    expect(utils.hasTestSucceeded([passingPollResult, timeoutPollResult], false, true)).toBeFalsy()
    expect(utils.hasTestSucceeded([passingPollResult, timeoutPollResult], false, false)).toBeTruthy()
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

    const getPassingPollResult = (resultId: string) => ({
      check: getTestConfig(),
      dc_id: 42,
      result: getBrowserResult({error: ERRORS.TIMEOUT, passed: false}),
      resultID: resultId,
      timestamp: 0,
    })

    const getTestAndResult = (publicId = 'abc-def-ghi', resultId = '0123456789') => {
      const triggerResult = {
        device: 'laptop_large',
        location: 42,
        public_id: publicId,
        result_id: resultId,
      }
      const triggerConfig = {
        config: {},
        id: publicId,
        suite: 'Suite 1',
      }

      const passingPollResult = getPassingPollResult(resultId)

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
})
