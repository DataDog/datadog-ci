// tslint:disable: no-string-literal

import {AxiosError, AxiosResponse} from 'axios'
import * as ciUtils from '../../../helpers/utils'

import {ExecutionRule} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {DEFAULT_COMMAND_CONFIG, removeUndefinedValues, RunTestCommand} from '../run-test'
import * as utils from '../utils'
import {mockReporter} from './fixtures'

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
      // Override with config file
      jest
        .spyOn(ciUtils, 'getConfig')
        .mockImplementation(async () => ({global: configOverride, publicIds: ['public-id-1', 'public-id-2']}))
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
      jest
        .spyOn(ciUtils, 'getConfig')
        .mockImplementation(async () => ({global: configOverride, publicIds: ['public-id-1', 'public-id-2']}))
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

    test('getTestsList throws', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        searchTests: jest.fn(() => {
          throw serverError
        }),
      }

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['config'].tunnel = true
      command['testSearchQuery'] = 'a-search-query'

      expect(await command.execute()).toBe(0)

      command['failOnCriticalErrors'] = true
      expect(await command.execute()).toBe(1)
    })

    test('getTestsToTrigger throws', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)

      const serverError = new Error('Server Error') as AxiosError
      serverError.response = {data: {errors: ['Bad Gateway']}, status: 502} as AxiosResponse
      serverError.config = {baseURL: 'baseURL', url: 'url'}
      const apiHelper = {
        getTest: jest.fn(() => {
          throw serverError
        }),
      }

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['config'].tunnel = true
      command['publicIds'] = ['public-id-1']

      expect(await command.execute()).toBe(0)

      command['failOnCriticalErrors'] = true
      expect(await command.execute()).toBe(1)
    })

    test('getPresignedURL throws', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {passed: 0, failed: 0, skipped: 0, notFound: 0},
          tests: [],
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

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['config'].tunnel = true
      command['publicIds'] = ['public-id-1', 'public-id-2']

      expect(await command.execute()).toBe(0)

      command['failOnCriticalErrors'] = true
      expect(await command.execute()).toBe(1)
    })

    test('runTests throws', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {passed: 0, failed: 0, skipped: 0, notFound: 0},
          tests: [],
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

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['publicIds'] = ['public-id-1', 'public-id-2']

      expect(await command.execute()).toBe(0)

      command['failOnCriticalErrors'] = true
      expect(await command.execute()).toBe(1)
    })

    test('waitForResults throws', async () => {
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getTestsToTrigger').mockReturnValue(
        Promise.resolve({
          overriddenTestsToTrigger: [],
          summary: {passed: 0, failed: 0, skipped: 0, notFound: 0},
          tests: [{public_id: 'publicId'} as any],
        })
      )

      jest.spyOn(utils, 'runTests').mockReturnValue(
        Promise.resolve({
          locations: [],
          results: [{options: {ci: {executionRule: ExecutionRule.BLOCKING}}, public_id: 'test'} as any],
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

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['getApiHelper'] = (() => apiHelper) as any
      command['publicIds'] = ['public-id-1', 'public-id-2']

      expect(await command.execute()).toBe(0)
    })
  })

  describe('getAppBaseURL', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should default to datadog us', async () => {
      process.env = {}
      const command = new RunTestCommand()

      expect(command['getAppBaseURL']()).toBe('https://app.datadoghq.com/')
    })

    test('subdomain should be overridable', async () => {
      process.env = {DATADOG_SUBDOMAIN: 'custom'}
      const command = new RunTestCommand()
      await command['resolveConfig']()

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.com/')
    })

    test('should override subdomain and site', async () => {
      process.env = {
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SUBDOMAIN: 'custom',
      }
      const command = new RunTestCommand()
      await command['resolveConfig']()

      expect(command['getAppBaseURL']()).toBe('https://custom.datadoghq.eu/')
    })
  })

  describe('getDatadogHost', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should default to datadog us api', async () => {
      process.env = {}
      const command = new RunTestCommand()
      await command['resolveConfig']()

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.com/api/v1')
      expect(command['getDatadogHost'](true)).toBe('https://intake.synthetics.datadoghq.com/api/v1')
    })

    test('should be tunable through DATADOG_SITE variable', async () => {
      process.env = {DATADOG_SITE: 'datadoghq.eu'}
      const command = new RunTestCommand()
      await command['resolveConfig']()

      expect(command['getDatadogHost']()).toBe('https://api.datadoghq.eu/api/v1')
      expect(command['getDatadogHost'](true)).toBe('https://api.datadoghq.eu/api/v1')
    })
  })

  describe('getApiHelper', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

    test('should throw an error if API or Application key are undefined', async () => {
      process.env = {}
      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['reporter'] = utils.getReporter([new DefaultReporter(command)])
      await command['resolveConfig']()

      expect(command['getApiHelper'].bind(command)).toThrowError(/API and\/or Application keys are missing/)
      expect(write.mock.calls[0][0]).toContain('DATADOG_APP_KEY')
      expect(write.mock.calls[1][0]).toContain('DATADOG_API_KEY')

      command['appKey'] = 'fakeappkey'
      await command['resolveConfig']()
      write.mockClear()
      expect(command['getApiHelper'].bind(command)).toThrowError(/API and\/or Application keys are missing/)
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
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
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}

      expect(await command['getTestsList'].bind(command)(fakeApi)).toEqual([
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
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}
      command['testSearchQuery'] = 'fake search'

      await command['resolveConfig']()
      expect(await command['getTestsList'].bind(command)(fakeApi)).toEqual([
        {
          config: {startUrl},
          id: 'stu-vwx-yza',
        },
      ])
    })

    test('should use given globs to get tests list', async () => {
      const getSuitesMock = jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf1, conf2]) as any)
      const command = new RunTestCommand()
      command.context = process
      command['config'].global = {startUrl}
      command['reporter'] = mockReporter
      command['files'] = ['new glob', 'another one']

      await command['resolveConfig']()
      await command['getTestsList'].bind(command)(fakeApi)
      expect(getSuitesMock).toHaveBeenCalledTimes(2)
      expect(getSuitesMock).toHaveBeenCalledWith('new glob', command['reporter'])
      expect(getSuitesMock).toHaveBeenCalledWith('another one', command['reporter'])
    })
  })

  describe('sortTestsByOutcome', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })

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

  describe('resolveConfig', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
      process.env = {}
      jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    })

    test('override from ENV', async () => {
      const overrideEnv = {
        DATADOG_API_KEY: 'fake_api_key',
        DATADOG_APP_KEY: 'fake_app_key',
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SUBDOMAIN: 'custom',
      }

      process.env = overrideEnv
      const command = new RunTestCommand()

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        datadogSite: overrideEnv.DATADOG_SITE,
        subdomain: overrideEnv.DATADOG_SUBDOMAIN,
      })
    })

    test('override from config file', async () => {
      const overrideConfigFile = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'fake-datadog-ci.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnTimeout: false,
        files: ['my-new-file'],
        global: {locations: []},
        pollingTimeout: 1,
        proxy: {protocol: 'https'},
        publicIds: ['ran-dom-id'],
        subdomain: 'ppa',
        tunnel: true,
      }

      jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => overrideConfigFile)
      const command = new RunTestCommand()

      await command['resolveConfig']()
      expect(command['config']).toEqual(overrideConfigFile)
    })

    test('override from CLI', async () => {
      const overrideCLI = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'fake-datadog-ci.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnTimeout: false,
        files: ['new-file'],
        publicIds: ['ran-dom-id'],
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      }

      const command = new RunTestCommand()
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
      command['failOnTimeout'] = overrideCLI.failOnTimeout
      command['files'] = overrideCLI.files
      command['publicIds'] = overrideCLI.publicIds
      command['subdomain'] = overrideCLI.subdomain
      command['tunnel'] = overrideCLI.tunnel
      command['testSearchQuery'] = overrideCLI.testSearchQuery

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'fake-datadog-ci.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnTimeout: false,
        files: ['new-file'],
        publicIds: ['ran-dom-id'],
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      })
    })

    test('override from config file < ENV < CLI', async () => {
      jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({
        apiKey: 'api_key_config_file',
        appKey: 'app_key_config_file',
        datadogSite: 'datadog.config.file',
      }))

      process.env = {
        DATADOG_API_KEY: 'api_key_env',
        DATADOG_APP_KEY: 'app_key_env',
      }

      const command = new RunTestCommand()
      command['apiKey'] = 'api_key_cli'

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'datadog.config.file',
      })
    })
  })

  test('removeUndefinedValues', () => {
    // tslint:disable-next-line: no-null-keyword
    expect(removeUndefinedValues({a: 'b', c: 'd', e: undefined, g: null})).toEqual({a: 'b', c: 'd', g: null})
  })
})
