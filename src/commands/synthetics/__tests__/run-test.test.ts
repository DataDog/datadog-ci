// tslint:disable: no-string-literal
jest.mock('fs')

import * as ciUtils from '../../../helpers/utils'

import {ExecutionRule} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {RunTestCommand} from '../run-test'
import * as utils from '../utils'
import {mockReporter} from './fixtures'

export const assertAsyncThrow = async (func: any, errorRegex?: RegExp) => {
  let error
  try {
    await func()
    console.error('Function has not thrown')
  } catch (e) {
    error = e
    if (errorRegex) {
      expect(e.toString()).toMatch(errorRegex)
    }
  }

  expect(error).toBeTruthy()

  return error
}

describe('run-test', () => {
  describe('execute', () => {
    test('should apply config override for tests triggered by public id', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {passed: 0, failed: 0, skipped: 0, notFound: 0},
          tests: [],
        })
      )
      jest.spyOn(utils, 'runTests').mockImplementation()

      const startUrl = '{{PROTOCOL}}//myhost{{PATHNAME}}{{PARAMS}}'
      const locations = ['location1', 'location2']
      const configOverride = {locations, startUrl}

      const apiHelper = {}
      const command = new RunTestCommand()
      command.context = {stdout: {write: jest.fn()}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['config'].global = configOverride
      command['publicIds'] = ['public-id-1', 'public-id-2']
      await command.execute()

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
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      const getTestsToTriggersMock = jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {passed: 0, failed: 0, skipped: 0, notFound: 0},
          tests: [],
        })
      )
      const runTestsMock = jest
        .spyOn(utils, 'runTests')
        .mockReturnValue(Promise.resolve({locations: [], results: [], triggered_check_ids: []}))
      const waitForResultSpy = jest.spyOn(utils, 'waitForResults')

      const apiHelper = {}
      const write = jest.fn()
      const command = new RunTestCommand()
      const configOverride = {executionRule: ExecutionRule.SKIPPED}
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['config'].global = configOverride
      command['publicIds'] = ['public-id-1', 'public-id-2']

      await command.execute()

      expect(getTestsToTriggersMock).toHaveBeenCalledWith(
        apiHelper,
        expect.arrayContaining([
          expect.objectContaining({id: 'public-id-1', config: configOverride}),
          expect.objectContaining({id: 'public-id-2', config: configOverride}),
        ]),
        expect.anything()
      )
      expect(runTestsMock).toHaveBeenCalledWith(apiHelper, [])
      expect(write).toHaveBeenCalledWith('No test to run.\n')
      expect(waitForResultSpy).not.toHaveBeenCalled()
    })
  })

  describe('getAppBaseURL', () => {
    test('should default to datadog us', async () => {
      process.env = {}
      const command = new RunTestCommand()

      expect(command['getAppBaseURL']()).toBe('https://app.datadoghq.com/')
    })

    test('subdomain should be overridable', async () => {
      process.env = {DATADOG_SUBDOMAIN: 'custom'}
      const command = new RunTestCommand()

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.com/')
    })

    test('should override subdomain and site', async () => {
      process.env = {
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SUBDOMAIN: 'custom',
      }
      const command = new RunTestCommand()

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.eu/')
    })
  })

  describe('getDatadogHost', () => {
    test('should default to datadog us api', async () => {
      process.env = {}
      const command = new RunTestCommand()

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.com/api/v1')
      expect(command['getDatadogHost'](true)).toBe('https://intake.synthetics.datadoghq.com/api/v1')
    })

    test('should be tunable through DATADOG_SITE variable', async () => {
      process.env = {DATADOG_SITE: 'datadoghq.eu'}
      const command = new RunTestCommand()

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.eu/api/v1')
      expect(command['getDatadogHost'](true)).toBe('https://api.datadoghq.eu/api/v1')
    })
  })

  describe('getApiHelper', () => {
    test('should throw an error if API or Application key are undefined', async () => {
      process.env = {}
      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['reporter'] = utils.getReporter([new DefaultReporter(command)])

      await assertAsyncThrow(command['getApiHelper'].bind(command), /API and\/or Application keys are missing/)
      expect(write.mock.calls[0][0]).toContain('DATADOG_APP_KEY')
      expect(write.mock.calls[1][0]).toContain('DATADOG_API_KEY')

      command['appKey'] = 'fakeappkey'

      write.mockClear()
      await assertAsyncThrow(command['getApiHelper'].bind(command), /API and\/or Application keys are missing/)
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
  })

  describe('getTestsList', () => {
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
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}

      expect(await command['getTestsList'].bind(command)(fakeApi)).toEqual([
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
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}
      command['testSearchQuery'] = 'fake search'

      expect(await command['getTestsList'].bind(command)(fakeApi)).toEqual([
        {
          config: {startUrl},
          id: 'stu-vwx-yza',
          suite: 'Query: fake search',
        },
      ])
    })

    test('should use given globs to get tests list', async () => {
      const mockFn = jest.spyOn(utils, 'getSuites').mockImplementation((() => fakeSuites) as any)
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}
      command['config'].files = 'random glob'
      command['reporter'] = mockReporter

      command['fileGlobs'] = ['new glob', 'another one']
      await command['getTestsList'].bind(command)(fakeApi)
      expect(utils.getSuites).toHaveBeenCalledTimes(2)
      expect(utils.getSuites).toHaveBeenCalledWith('new glob', command['reporter'])
      expect(utils.getSuites).toHaveBeenCalledWith('another one', command['reporter'])

      mockFn.mockClear()

      command['fileGlobs'] = undefined
      await command['getTestsList'].bind(command)(fakeApi)
      expect(utils.getSuites).toHaveBeenCalledTimes(1)
      expect(utils.getSuites).toHaveBeenCalledWith('random glob', command['reporter'])
    })
  })

  describe('sortTestsByOutcome', () => {
    const test1 = {options: {}, public_id: 'test1'}
    const test2 = {options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'test2'}
    const test3 = {options: {ci: {executionRule: ExecutionRule.NON_BLOCKING}}, public_id: 'test3'}
    const test4 = {options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'test4'}
    const test5 = {options: {ci: {executionRule: ExecutionRule.NON_BLOCKING}}, public_id: 'test5'}
    const tests = [test1, test2, test3, test4, test5]
    const results = {
      test1: [{result: {passed: true}}],
      test2: [{result: {passed: true}}],
      test3: [{result: {passed: true}}],
      test4: [{result: {passed: false}}],
      test5: [{result: {passed: false}}],
    }

    test('should sort tests with success, non_blocking failures then failures', async () => {
      const command = new RunTestCommand()

      tests.sort((command['sortTestsByOutcome'] as any)(results))
      expect(tests).toStrictEqual([test3, test1, test2, test5, test4])
    })
  })
})
