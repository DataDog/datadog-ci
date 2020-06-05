jest.mock('glob')
jest.mock('fs')

import * as fs from 'fs'

import * as axios from 'axios'
import glob from 'glob'

import {apiConstructor} from '../api'
import {ExecutionRule, PollResult, ProxyConfiguration, Result, Test} from '../interfaces'
import {
  getStrictestExecutionRule,
  getSuites,
  handleConfig,
  hasResultPassed,
  hasTestSucceeded,
  runTests,
  waitForResults,
} from '../utils'

async function wait(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

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
      file1: '{"content":"file1"}',
      file2: '{"content":"file2"}',
    }

    ;(fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path])
    )
    ;(glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES))

    test('should get suites', async () => {
      const suites = await getSuites(GLOB, process.stdout.write.bind(process.stdout))
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`)
    })
  })

  describe('runTest', () => {
    const processWrite = process.stdout.write.bind(process.stdout)
    const fakeTest = {
      name: 'Fake Test',
      public_id: '123-456-789',
    }
    const fakeTrigger = {
      results: [],
      triggered_check_ids: [fakeTest.public_id],
    }

    beforeAll(() => {
      const axiosMock = jest.spyOn(axios.default, 'create')
      axiosMock.mockImplementation((() => (e: any) => {
        if (e.url === '/synthetics/tests/trigger/ci') {
          return {data: fakeTrigger}
        }

        if (e.url === `/synthetics/tests/${fakeTest.public_id}`) {
          return {data: fakeTest}
        }
      }) as any)
    })

    afterAll(() => {
      jest.clearAllMocks()
    })

    test('should run test', async () => {
      const output = await runTests(api, [{id: fakeTest.public_id, config: {}}], processWrite)
      expect(output).toEqual({tests: [fakeTest], triggers: fakeTrigger})
    })

    test('should run test with publicId from url', async () => {
      const output = await runTests(
        api,
        [
          {
            config: {},
            id: `http://localhost/synthetics/tests/details/${fakeTest.public_id}`,
          },
        ],
        processWrite
      )
      expect(output).toEqual({tests: [fakeTest], triggers: fakeTrigger})
    })

    test('no tests triggered throws an error', async () => {
      let hasThrown = false
      try {
        await runTests(api, [], processWrite)
      } catch (e) {
        hasThrown = true
      }
      expect(hasThrown).toBeTruthy()
    })

    test('skipped tests should not be run', async () => {
      let hasThrown = false
      try {
        const config = {executionRule: ExecutionRule.SKIPPED}
        await runTests(api, [{id: fakeTest.public_id, config}], processWrite)
      } catch (e) {
        hasThrown = true
      }
      expect(hasThrown).toBeTruthy()
    })
  })

  describe('handleConfig', () => {
    test('empty config returns simple payload', () => {
      const publicId = 'abc-def-ghi'
      expect(handleConfig({public_id: publicId} as Test, publicId)).toEqual({
        public_id: publicId,
      })
    })

    test('executionRule is not picked', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://example.org/path'}},
        options: {},
        public_id: publicId,
      } as Test
      const configOverride = {executionRule: ExecutionRule.SKIPPED}
      const handledConfig = handleConfig(fakeTest, publicId, configOverride)

      expect(handledConfig.public_id).toBe(publicId)
    })

    test('startUrl template is rendered', () => {
      const publicId = 'abc-def-ghi'
      const fakeTest = {
        config: {request: {url: 'http://example.org/path'}},
        public_id: publicId,
      } as Test
      const configOverride = {
        startUrl: 'https://{{DOMAIN}}/newPath?oldPath={{PATHNAME}}',
      }
      const expectedUrl = 'https://example.org/newPath?oldPath=/path'
      const handledConfig = handleConfig(fakeTest, publicId, configOverride)

      expect(handledConfig.public_id).toBe(publicId)
      expect(handledConfig.startUrl).toBe(expectedUrl)
    })
  })

  describe('hasResultPassed', () => {
    test('complete result', () => {
      const result = {
        device: {
          id: 'laptop_large',
        },
        eventType: 'finished',
        passed: true,
        stepDetails: [],
      }
      expect(hasResultPassed(result)).toBeTruthy()
      result.passed = false
      expect(hasResultPassed(result)).toBeFalsy()
    })

    test('result with error', () => {
      const result: Result = {
        device: {id: 'laptop_large'},
        errorCode: 'ERRABORTED',
        eventType: 'finished',
        passed: false,
        stepDetails: [],
      }
      expect(hasResultPassed(result)).toBeFalsy()
    })
  })

  test('hasTestSucceeded', () => {
    const passingResult = {
      device: {
        id: 'laptop_large',
      },
      eventType: 'finished',
      passed: true,
      stepDetails: [],
    }
    const passingPollResult = {
      dc_id: 42,
      result: passingResult,
      resultID: '0123456789',
    }
    const failingPollResult = {
      dc_id: 42,
      result: {...passingResult, passed: false},
      resultID: '0123456789',
    }
    expect(hasTestSucceeded([passingPollResult, failingPollResult])).toBeFalsy()
    expect(hasTestSucceeded([passingPollResult, passingPollResult])).toBeTruthy()
  })

  describe('waitForResults', () => {
    beforeAll(() => {
      jest.setTimeout(10000)
      const axiosMock = jest.spyOn(axios.default, 'create')
      axiosMock.mockImplementation((() => async (r: axios.AxiosRequestConfig) => {
        await wait(100)

        const results = JSON.parse(r.params.result_ids)
          .filter((resultId: string) => resultId !== 'timingOutTest')
          .map((resultId: string) => passingPollResult(resultId))

        return {data: {results}}
      }) as any)
    })

    afterAll(() => {
      jest.setTimeout(5000)
      jest.clearAllMocks()
    })

    const passingResult = {
      device: {
        id: 'laptop_large',
      },
      eventType: 'finished',
      passed: true,
      stepDetails: [],
    }
    const passingPollResult = (resultID: string) => ({
      dc_id: 42,
      result: passingResult,
      resultID,
    })
    const publicId = 'abc-def-ghi'
    const triggerResult = {
      device: 'laptop_large',
      location: 42,
      public_id: publicId,
      result_id: '0123456789',
    }
    const triggerConfig = {
      config: { },
      id: publicId,
    }

    test('should poll result ids', async () => {
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[publicId] = [passingPollResult('0123456789')]
      expect(await waitForResults(api, [triggerResult], 120000, [triggerConfig])).toEqual(expectedResults)
    })

    test('results should be timeout-ed if global pollingTimeout is exceeded', async () => {
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[publicId] = [
        {
          dc_id: triggerResult.location,
          result: {
            device: {id: triggerResult.device},
            error: 'Timeout',
            eventType: 'finished',
            passed: false,
            stepDetails: [],
          },
          resultID: triggerResult.result_id,
        },
      ]
      expect(await waitForResults(api, [triggerResult], 0, [])).toEqual(expectedResults)
    })

    test('results should be timeout-ed if test pollingTimeout is exceeded', async () => {
      const expectedResults: {[key: string]: PollResult[]} = {}
      expectedResults[publicId] = [
        {
          dc_id: triggerResult.location,
          result: {
            device: {id: triggerResult.device},
            error: 'Timeout',
            eventType: 'finished',
            passed: false,
            stepDetails: [],
          },
          resultID: triggerResult.result_id,
        },
      ]
      const testTriggerConfig = {
        config: {pollingTimeout: 0},
        id: publicId,
      }
      expect(await waitForResults(api, [triggerResult], 120000, [testTriggerConfig])).toEqual(expectedResults)
    })

    test('correct number of pass and timeout results', async () => {
      const expectedResults: {[key: string]: PollResult[]} = {}
      const triggerResultPass = triggerResult
      const triggerResultTimeOut = {
        ...triggerResult,
        result_id: 'timingOutTest',
      }
      expectedResults[publicId] = [
        passingPollResult(triggerResultPass.result_id),
        {
          dc_id: triggerResultTimeOut.location,
          result: {
            device: {id: triggerResultTimeOut.device},
            error: 'Timeout',
            eventType: 'finished',
            passed: false,
            stepDetails: [],
          },
          resultID: triggerResultTimeOut.result_id,
        },
      ]
      expect(await waitForResults(api, [triggerResultPass, triggerResultTimeOut], 2000, [])).toEqual(expectedResults)
    })
  })

  test('getStrictestExecutionRule', () => {
    const BLOCKING = ExecutionRule.BLOCKING
    const NON_BLOCKING = ExecutionRule.NON_BLOCKING
    const SKIPPED = ExecutionRule.SKIPPED
    expect(getStrictestExecutionRule(BLOCKING, NON_BLOCKING)).toBe(NON_BLOCKING)
    expect(getStrictestExecutionRule(NON_BLOCKING, BLOCKING)).toBe(NON_BLOCKING)
    expect(getStrictestExecutionRule(NON_BLOCKING, SKIPPED)).toBe(SKIPPED)
    expect(getStrictestExecutionRule(BLOCKING, undefined)).toBe(BLOCKING)
    expect(getStrictestExecutionRule(SKIPPED, undefined)).toBe(SKIPPED)
  })
})
