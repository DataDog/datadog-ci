// tslint:disable: no-string-literal
import {AxiosError, AxiosResponse} from 'axios'
import {Cli} from 'clipanion/lib/advanced'
import deepExtend from 'deep-extend'
import * as ciUtils from '../../../helpers/utils'
import {DEFAULT_COMMAND_CONFIG, RunTestCommand} from '../command'
import {ExecutionRule, Result, Test} from '../interfaces'
import * as runTests from '../run-test'
import * as utils from '../utils'
import {
  getApiResult,
  getApiTest,
  getTestSuite,
  MockedReporter,
  mockReporter,
  mockTestTriggerResponse,
  RenderResultsHelper,
  RenderResultsTestCase,
} from './fixtures'

test('all option flags are supported', async () => {
  const options = [
    'apiKey',
    'appKey',
    'failOnCriticalErrors',
    'config',
    'datadogSite',
    'files',
    'failOnTimeout',
    'public-id',
    'search',
    'subdomain',
    'tunnel',
    'jUnitReport',
    'runName',
  ]

  const cli = new Cli()
  cli.register(RunTestCommand)
  const usage = cli.usage(RunTestCommand)

  options.forEach((option) => expect(usage).toContain(`--${option}`))
})

const getAxiosHttpError = (status: number, error: string) => {
  const serverError = new Error(error) as AxiosError
  serverError.response = {data: {errors: [error]}, status} as AxiosResponse
  serverError.config = {baseURL: 'baseURL', url: 'url'}

  return serverError
}

describe('run-test', () => {
  beforeEach(() => {
    jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    process.env = {}
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

  describe('sortResultsByOutcome', () => {
    const test1 = getApiTest('test1')
    const test2 = deepExtend(getApiTest('test2'), {options: {ci: {executionRule: ExecutionRule.BLOCKING}}})
    const test3 = deepExtend(getApiTest('test3'), {options: {ci: {executionRule: ExecutionRule.NON_BLOCKING}}})
    const test4 = deepExtend(getApiTest('test4'), {options: {ci: {executionRule: ExecutionRule.BLOCKING}}})
    const test5 = deepExtend(getApiTest('test5'), {options: {ci: {executionRule: ExecutionRule.NON_BLOCKING}}})
    const results: Result[] = [
      deepExtend(getApiResult('1', test1), {passed: true}),
      deepExtend(getApiResult('2', test2), {passed: true}),
      deepExtend(getApiResult('3', test3), {passed: true}),
      deepExtend(getApiResult('4', test4), {passed: false}),
      deepExtend(getApiResult('5', test5), {passed: false}),
    ]

    test('should sort tests with success, non_blocking failures then failures', async () => {
      const command = new RunTestCommand()
      const sortedResults = [...results]
      sortedResults.sort((command['sortResultsByOutcome'] as any)())
      expect(sortedResults.map((r) => r.resultId)).toStrictEqual(['3', '1', '2', '5', '4'])
    })
  })

  describe('resolveConfig', () => {
    beforeEach(() => {
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
        locations: [],
        pollingTimeout: 1,
        proxy: {protocol: 'https'},
        publicIds: ['ran-dom-id'],
        subdomain: 'ppa',
        tunnel: true,
        variableStrings: [],
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

    test('override locations with ENV variable', async () => {
      const conf = {
        content: {tests: [{config: {}, id: 'publicId'}]},
        name: 'Suite 1',
      }

      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [conf]) as any)

      // Throw to stop the test
      const triggerTests = jest.fn(() => {
        throw getAxiosHttpError(502, 'Bad Gateway')
      })

      const apiHelper = {
        getTest: jest.fn(() => ({...getApiTest('publicId')})),
        triggerTests,
      }

      const write = jest.fn()
      const command = new RunTestCommand()
      command.context = {stdout: {write}} as any
      command['config'].global = {locations: ['aws:us-east-2']}
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)

      expect(await command.execute()).toBe(0)
      expect(triggerTests).toHaveBeenCalledWith(
        expect.objectContaining({
          tests: [{executionRule: 'blocking', locations: ['aws:us-east-2'], public_id: 'publicId'}],
        })
      )

      // Env > global
      process.env = {
        DATADOG_SYNTHETICS_LOCATIONS: 'aws:us-east-3',
      }
      expect(await command.execute()).toBe(0)
      expect(triggerTests).toHaveBeenCalledTimes(2)
      expect(triggerTests).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          tests: [{executionRule: 'blocking', locations: ['aws:us-east-3'], public_id: 'publicId'}],
        })
      )

      process.env = {
        DATADOG_SYNTHETICS_LOCATIONS: 'aws:us-east-3;aws:us-east-4',
      }
      expect(await command.execute()).toBe(0)
      expect(triggerTests).toHaveBeenCalledTimes(3)
      expect(triggerTests).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          tests: [{executionRule: 'blocking', locations: ['aws:us-east-3', 'aws:us-east-4'], public_id: 'publicId'}],
        })
      )

      // Test > env
      const confWithLocation = {
        content: {tests: [{config: {locations: ['aws:us-east-1']}, id: 'publicId'}]},
      }
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [confWithLocation]) as any)

      expect(await command.execute()).toBe(0)
      expect(triggerTests).toHaveBeenCalledWith(
        expect.objectContaining({
          tests: [{executionRule: 'blocking', locations: ['aws:us-east-1'], public_id: 'publicId'}],
        })
      )
    })
  })

  describe('exit code respects `failOnCriticalErrors`', () => {
    test('404 leading to `NO_TESTS_TO_RUN` never exit with 1', async () => {
      const command = new RunTestCommand()
      command.context = {stdout: {write: jest.fn()}} as any
      command['config'].failOnCriticalErrors = true

      const apiHelper = {
        getTest: jest.fn(() => {
          throw getAxiosHttpError(404, 'Test not found')
        }),
      }
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

      expect(await command.execute()).toBe(0)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
    })

    test('`NO_RESULTS_TO_POLL` never exit with 1', async () => {
      const command = new RunTestCommand()
      command.context = {stdout: {write: jest.fn()}} as any
      command['config'].failOnCriticalErrors = true

      const apiHelper = {
        getTest: () => getApiTest('123-456-789'),
        triggerTests: jest.fn(() => ({})),
      }
      jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

      expect(await command.execute()).toBe(0)
      expect(apiHelper.triggerTests).toHaveBeenCalledTimes(1)
    })

    describe.each([false, true])('%s', (failOnCriticalErrors: boolean) => {
      const cases: [string, number?][] = [['HTTP 4xx error', 403], ['HTTP 5xx error', 502], ['Unknown error']]
      const expectedExit = failOnCriticalErrors ? 1 : 0

      describe.each(cases)('%s', (_, errorCode) => {
        test('unable to obtain test configurations', async () => {
          const command = new RunTestCommand()
          command.context = {stdout: {write: jest.fn()}} as any
          command['config'].failOnCriticalErrors = failOnCriticalErrors
          command['testSearchQuery'] = 'test:search'

          const apiHelper = {
            searchTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, 'Error') : new Error('Unknown error')
            }),
          }
          jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, __) => config)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.searchTests).toHaveBeenCalledTimes(1)
        })

        test('unavailable test config', async () => {
          const command = new RunTestCommand()
          command.context = {stdout: {write: jest.fn()}} as any
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getTest: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, 'Error') : new Error('Unknown error')
            }),
          }
          jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
        })

        test('unable to trigger tests', async () => {
          const command = new RunTestCommand()
          command.context = {stdout: {write: jest.fn()}} as any
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getTest: () => getApiTest('123-456-789'),
            triggerTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, 'Error') : new Error('Unknown error')
            }),
          }
          jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.triggerTests).toHaveBeenCalledTimes(1)
        })

        test('unable to poll test results', async () => {
          const command = new RunTestCommand()
          command.context = {stdout: {write: jest.fn()}} as any
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getTest: () => getApiTest('123-456-789'),
            pollResults: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, 'Error') : new Error('Unknown error')
            }),
            triggerTests: () => ({
              ...mockTestTriggerResponse,
              results: [{location: 1, public_id: '123-456-789', result_id: '1'}],
            }),
          }
          jest.spyOn(runTests, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.pollResults).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('Render results', () => {
    const emptySummary = utils.createSummary()

    const test1 = {
      configOverride: {executionRule: ExecutionRule.BLOCKING, startUrl: 'foo'},
      publicId: 'aaa-aaa-aaa',
      resultPassed: true,
    }
    const test1Timeout = {...test1, resultError: 'Timeout', resultPassed: false}
    const test1CriticalError = {...test1, resultIsUnhealthy: true, resultPassed: false}
    const test1FailedNonBlocking = {
      ...test1,
      configOverride: {...test1.configOverride, executionRule: ExecutionRule.NON_BLOCKING, startUrl: 'bar'},
      resultPassed: false,
    }
    const test1Failed = {
      ...test1,
      configOverride: {...test1.configOverride, executionRule: ExecutionRule.BLOCKING, startUrl: 'baz'},
      resultPassed: false,
    }
    const test1NonBlocking = {...test1, executionRule: ExecutionRule.NON_BLOCKING}
    const test1NonBlockingFailedNonBlocking = {...test1FailedNonBlocking, executionRule: ExecutionRule.NON_BLOCKING}
    const test1NonBlockingFailed = {...test1Failed, executionRule: ExecutionRule.NON_BLOCKING}
    const test2Failed = {
      configOverride: {executionRule: ExecutionRule.BLOCKING, startUrl: 'bar'},
      publicId: 'bbb-bbb-bbb',
      resultPassed: false,
    }
    const test3 = {
      configOverride: {executionRule: ExecutionRule.BLOCKING, startUrl: 'baz'},
      publicId: 'ccc-ccc-ccc',
      resultPassed: true,
    }

    const cases: RenderResultsTestCase[] = [
      {
        description: '1 API test with 1 config override, 1 result (passed)',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, passed: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed timeout), no fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, passed: 1, timedOut: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1Timeout]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed timeout), fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 1,
          summary: {...emptySummary, failed: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: true,
        fixtures: new RenderResultsHelper().createFixtures([test1Timeout]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed critical error), no fail on timeout, no fail on critical errors',
        expected: {
          exitCode: 0,
          summary: {...emptySummary, passed: 1, criticalErrors: 1},
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1CriticalError]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test with 1 config override, 1 result (failed critical error), no fail on timeout, fail on critical errors',
        expected: {
          exitCode: 1,
          summary: {...emptySummary, failed: 1},
        },
        failOnCriticalErrors: true,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1CriticalError]),
        summary: {...emptySummary},
      },
      {
        description:
          '1 API test (blocking) with 4 config overrides (1 skipped), 3 results (1 passed, 1 failed, 1 failed non-blocking)',
        expected: {
          exitCode: 1,
          summary: {
            ...emptySummary,
            failed: 1,
            failedNonBlocking: 1,
            passed: 1,
            skipped: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1, test1FailedNonBlocking, test1Failed]),
        summary: {...emptySummary, skipped: 1},
      },
      {
        description:
          '1 API test (non-blocking) with 4 config overrides (1 skipped), 3 results (1 passed, 1 failed, 1 failed non-blocking)',
        expected: {
          exitCode: 0,
          summary: {
            ...emptySummary,
            failedNonBlocking: 2,
            passed: 1,
            skipped: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([
          test1NonBlocking,
          test1NonBlockingFailedNonBlocking,
          test1NonBlockingFailed,
        ]),
        summary: {...emptySummary, skipped: 1},
      },
      {
        description:
          '3 API tests (blocking) with 1 config override each, 3 results (1 failed non-blocking, 1 failed, 1 passed)',
        expected: {
          exitCode: 1,
          summary: {
            ...emptySummary,
            failed: 1,
            failedNonBlocking: 1,
            passed: 1,
          },
        },
        failOnCriticalErrors: false,
        failOnTimeout: false,
        fixtures: new RenderResultsHelper().createFixtures([test1FailedNonBlocking, test2Failed, test3]),
        summary: {...emptySummary},
      },
    ]

    test.each(cases)('$description', async (testCase) => {
      testCase.fixtures.results.forEach(
        (result) =>
          (result.passed = utils.hasResultPassed(result.result, testCase.failOnCriticalErrors, testCase.failOnTimeout))
      )

      jest.spyOn(ciUtils, 'parseConfigFile').mockImplementation(async () => ({
        ...DEFAULT_COMMAND_CONFIG,
        failOnCriticalErrors: testCase.failOnCriticalErrors,
        failOnTimeout: testCase.failOnTimeout,
      }))
      jest.spyOn(utils, 'getReporter').mockImplementation(() => mockReporter)
      jest.spyOn(runTests, 'executeTests').mockResolvedValue({
        results: testCase.fixtures.results,
        summary: testCase.summary,
        tests: testCase.fixtures.tests,
        triggers: testCase.fixtures.triggers,
      })

      const command = new RunTestCommand()
      const write = jest.fn()
      command.context = {stdout: {write}} as any // For the DefaultReporter constructor

      const exitCode = await command.execute()

      expect((mockReporter as MockedReporter).resultEnd).toHaveBeenCalledTimes(testCase.fixtures.results.length)

      for (const result of testCase.fixtures.results) {
        expect((mockReporter as MockedReporter).resultEnd).toHaveBeenCalledWith(
          result,
          `https://${DEFAULT_COMMAND_CONFIG.subdomain}.${DEFAULT_COMMAND_CONFIG.datadogSite}/`
        )
      }

      expect(testCase.summary).toEqual(testCase.expected.summary)
      expect((mockReporter as MockedReporter).runEnd).toHaveBeenCalledWith(testCase.expected.summary)

      expect(exitCode).toBe(testCase.expected.exitCode)
    })
  })
})
