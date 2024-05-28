import {Cli} from 'clipanion/lib/advanced'

import {createCommand} from '../../../helpers/__tests__/fixtures'
import * as ciUtils from '../../../helpers/utils'

import * as api from '../api'
import {RunTestsCommandConfig, ServerTest, UploadApplicationCommandConfig, UserConfigOverride} from '../interfaces'
import {DEFAULT_COMMAND_CONFIG, DEFAULT_POLLING_TIMEOUT, RunTestsCommand} from '../run-tests-command'
import {DEFAULT_UPLOAD_COMMAND_CONFIG, UploadApplicationCommand} from '../upload-application-command'
import {toBoolean} from '../utils/internal'
import * as utils from '../utils/public'

import {getApiTest, getAxiosHttpError, getTestSuite, mockApi, mockTestTriggerResponse} from './fixtures'
test('all option flags are supported', async () => {
  const options = [
    'apiKey',
    'appKey',
    'config',
    'datadogSite',
    'deviceIds',
    'failOnCriticalErrors',
    'failOnMissingTests',
    'failOnTimeout',
    'files',
    'jUnitReport',
    'mobileApplicationVersion',
    'mobileApplicationVersionFilePath',
    'public-id',
    'runName',
    'search',
    'subdomain',
    'tunnel',
    'variable',
  ]

  const cli = new Cli()
  cli.register(RunTestsCommand)
  const usage = cli.usage(RunTestsCommand)

  options.forEach((option) => expect(usage).toContain(`--${option}`))
})

describe('run-test', () => {
  beforeEach(() => {
    process.env = {}
    jest.restoreAllMocks()
  })

  describe('resolveConfig', () => {
    beforeEach(() => {
      process.env = {}
    })

    test('override from ENV', async () => {
      const overrideEnv = {
        DATADOG_API_KEY: 'fake_api_key',
        DATADOG_APP_KEY: 'fake_app_key',
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SUBDOMAIN: 'custom',
        DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS: 'chrome.laptop_large',
        DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION: '00000000-0000-0000-0000-000000000000',
        DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config.json',
        DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS: 'false',
        DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS: 'false',
        DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT: 'false',
        DATADOG_SYNTHETICS_FILES: 'test-file1;test-file2;test-file3',
        DATADOG_SYNTHETICS_JUNIT_REPORT: 'junit-report.xml',
        DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id;another-public-id',
        DATADOG_SYNTHETICS_SELECTIVE_RERUN: 'true',
        DATADOG_SYNTHETICS_TEST_SEARCH_QUERY: 'a-search-query',
        DATADOG_SYNTHETICS_TUNNEL: 'false',
      }

      process.env = overrideEnv
      const command = createCommand(RunTestsCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: overrideEnv.DATADOG_SITE,
        defaultTestOverrides: {
          deviceIds: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS.split(';'),
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
          mobileApplicationVersion: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION,
        },
        failOnCriticalErrors: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS),
        failOnMissingTests: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS),
        failOnTimeout: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT),
        files: overrideEnv.DATADOG_SYNTHETICS_FILES.split(';'),
        jUnitReport: overrideEnv.DATADOG_SYNTHETICS_JUNIT_REPORT,
        publicIds: overrideEnv.DATADOG_SYNTHETICS_PUBLIC_IDS.split(';'),
        selectiveRerun: toBoolean(overrideEnv.DATADOG_SYNTHETICS_SELECTIVE_RERUN),
        subdomain: overrideEnv.DATADOG_SUBDOMAIN,
        testSearchQuery: overrideEnv.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
        tunnel: toBoolean(overrideEnv.DATADOG_SYNTHETICS_TUNNEL),
      })
    })

    test('override from config file', async () => {
      const overrideConfigFile: RunTestsCommandConfig = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['my-new-file'],
        jUnitReport: 'junit-report.xml',
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {
          deviceIds: ['chrome.laptop_large'],
          locations: ['us-east-1'],
          pollingTimeout: 2,
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
        },
        defaultTestOverrides: {
          deviceIds: ['chrome.laptop_large'],
          locations: ['us-east-1'],
          pollingTimeout: 2,
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
        },
        locations: [],
        pollingTimeout: 1,
        proxy: {
          protocol: 'https',
        },
        publicIds: ['ran-dom-id'],
        selectiveRerun: true,
        subdomain: 'ppa',
        testSearchQuery: 'a-search-query',
        tunnel: true,
        variableStrings: [],
      }

      const command = createCommand(RunTestsCommand)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(overrideConfigFile)
    })

    test('override from CLI', async () => {
      // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
      const overrideCLI: Omit<RunTestsCommandConfig, 'global' | 'defaultTestOverrides' | 'proxy'> = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        jUnitReport: 'junit-report.xml',
        locations: ['us-east-1'],
        mobileApplicationVersionFilePath: './path/to/application.apk',
        pollingTimeout: 1,
        publicIds: ['ran-dom-id'],
        selectiveRerun: true,
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
        variableStrings: ['key=value'],
      }
      const defaultTestOverrides: UserConfigOverride = {
        deviceIds: ['chrome.laptop_large'],
        mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
      }

      const command = createCommand(RunTestsCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['deviceIds'] = defaultTestOverrides.deviceIds
      command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
      command['failOnMissingTests'] = overrideCLI.failOnMissingTests
      command['failOnTimeout'] = overrideCLI.failOnTimeout
      command['files'] = overrideCLI.files
      command['jUnitReport'] = overrideCLI.jUnitReport
      command['mobileApplicationVersion'] = defaultTestOverrides.mobileApplicationVersion
      command['mobileApplicationVersionFilePath'] = overrideCLI.mobileApplicationVersionFilePath
      command['publicIds'] = overrideCLI.publicIds
      command['subdomain'] = overrideCLI.subdomain
      command['tunnel'] = overrideCLI.tunnel
      command['testSearchQuery'] = overrideCLI.testSearchQuery

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        jUnitReport: 'junit-report.xml',
        defaultTestOverrides: {
          deviceIds: ['chrome.laptop_large'],
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
        },
        publicIds: ['ran-dom-id'],
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      })
    })

    // We have 2 code paths that handle different levels of configuration overrides:
    //  1)  config file (configuration of datadog-ci)             <   ENV (environment variables)   <   CLI (command flags)
    //  2)  global (global config object, aka. `config.global`)   <   ENV (environment variables)   <   test file (test configuration)
    //
    // First, 1) configures datadog-ci itself and `config.global`,
    // Then, 2) configures the Synthetic tests to execute.
    //
    // So the bigger picture is:
    //
    // (config file < ENV < CLI < test file) => execute tests

    // TODO: Since we have "n choose k" = "4 choose 2" = ⁴C₂ = 6 possible combinations of "A < B",
    //       we should refactor the following 2 tests into 6 smaller tests, each testing a single override behavior.

    test('override from config file < ENV < CLI', async () => {
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
        ...baseConfig,
        apiKey: 'api_key_config_file',
        appKey: 'app_key_config_file',
        datadogSite: 'us5.datadoghq.com',
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {
          pollingTimeout: 111,
          mobileApplicationVersionFilePath: './path/to/application_config_file.apk',
        },
      }))

      process.env = {
        DATADOG_API_KEY: 'api_key_env',
        DATADOG_APP_KEY: 'app_key_env',
      }

      const command = createCommand(RunTestsCommand)
      command['apiKey'] = 'api_key_cli'
      command['mobileApplicationVersionFilePath'] = './path/to/application_cli.apk'
      command['pollingTimeout'] = 333

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'us5.datadoghq.com',
        global: {
          pollingTimeout: 111,
          mobileApplicationVersionFilePath: './path/to/application_config_file.apk',
        },
        defaultTestOverrides: {
          pollingTimeout: 333,
          mobileApplicationVersionFilePath: './path/to/application_cli.apk',
        },
      })
    })

    test('parameters override precedence: global < ENV < test file', async () => {
      const triggerTests = jest.fn(() => {
        throw getAxiosHttpError(502, {message: 'Bad Gateway'})
      })

      const apiHelper = mockApi({
        getTest: jest.fn(async () => ({...getApiTest('publicId')})),
        triggerTests,
      })

      const getExpectedTestsToTriggerArguments = (
        testOverrides: Partial<UserConfigOverride>
      ): Parameters<typeof utils['getTestsToTrigger']> => {
        return [
          // Parameters we care about.
          (apiHelper as unknown) as api.APIHelper,
          [{suite: 'Suite 1', id: 'aaa-bbb-ccc', testOverrides}],

          // Ignore the rest of the parameters.
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ]
      }

      const getTestsToTriggerMock = jest.spyOn(utils, 'getTestsToTrigger')

      const write = jest.fn()
      const command = createCommand(RunTestsCommand, {stderr: {write}})

      // Test file (empty config for now)
      const testFile = {name: 'Suite 1', content: {tests: [{id: 'aaa-bbb-ccc', testOverrides: {}}]}}
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
      jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
      jest.spyOn(utils, 'getSuites').mockResolvedValue([testFile])

      // Global
      // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
      command['config'].global = {
        locations: ['aws:us-east-2'],
        mobileApplicationVersionFilePath: './path/to/application_global.apk',
      }
      command['config'].defaultTestOverrides = {
        locations: ['aws:us-east-2'],
        mobileApplicationVersionFilePath: './path/to/application_global.apk',
      }

      expect(await command.execute()).toBe(0)
      expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
        1,
        ...getExpectedTestsToTriggerArguments({
          locations: ['aws:us-east-2'],
          mobileApplicationVersionFilePath: './path/to/application_global.apk',
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
        })
      )

      // Global < ENV
      process.env = {
        DATADOG_SYNTHETICS_LOCATIONS: 'aws:us-east-3',
      }
      expect(await command.execute()).toBe(0)
      expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
        2,
        ...getExpectedTestsToTriggerArguments({
          locations: ['aws:us-east-3'],
          mobileApplicationVersionFilePath: './path/to/application_global.apk',
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
        })
      )
      // Same, but with 2 locations.
      process.env = {
        DATADOG_SYNTHETICS_LOCATIONS: 'aws:us-east-3;aws:us-east-4',
      }
      expect(await command.execute()).toBe(0)
      expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
        3,
        ...getExpectedTestsToTriggerArguments({
          locations: ['aws:us-east-3', 'aws:us-east-4'],
          mobileApplicationVersionFilePath: './path/to/application_global.apk',
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
        })
      )

      // ENV < test file
      testFile.content.tests[0].testOverrides = {
        locations: ['aws:us-east-1'],
        mobileApplicationVersionFilePath: './path/to/application_test_file.apk',
      }
      expect(await command.execute()).toBe(0)
      expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
        4,
        ...getExpectedTestsToTriggerArguments({
          locations: ['aws:us-east-1'],
          mobileApplicationVersionFilePath: './path/to/application_test_file.apk',
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
        })
      )
    })

    test('pass command pollingTimeout as global override if undefined', async () => {
      const command = createCommand(RunTestsCommand)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-global-polling-timeout.json'
      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/config-with-global-polling-timeout.json',
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {followRedirects: false},
        defaultTestOverrides: {followRedirects: false, pollingTimeout: 333},
        pollingTimeout: 333,
      })
    })
  })

  describe('exit code respects `failOnCriticalErrors`', () => {
    test('404 leading to `NO_TESTS_TO_RUN` never exits with 1', async () => {
      const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
      command['config'].failOnCriticalErrors = true

      const apiHelper = mockApi({
        getTest: jest.fn(() => {
          throw getAxiosHttpError(404, {errors: ['Test not found']})
        }),
      })
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
      jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
      jest.spyOn(utils, 'getSuites').mockResolvedValue([getTestSuite()])

      expect(await command.execute()).toBe(0)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
    })

    describe.each([false, true])('%s', (failOnCriticalErrors: boolean) => {
      const cases: [string, number?][] = [['HTTP 4xx error', 403], ['HTTP 5xx error', 502], ['Unknown error']]
      const expectedExit = failOnCriticalErrors ? 1 : 0

      describe.each(cases)('%s', (_, errorCode) => {
        test('unable to obtain test configurations', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
          command['config'].failOnCriticalErrors = failOnCriticalErrors
          command['testSearchQuery'] = 'test:search'

          const apiHelper = mockApi({
            searchTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          })
          jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.searchTests).toHaveBeenCalledTimes(1)
        })

        test('unavailable test config', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = mockApi({
            getTest: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          })
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
          jest.spyOn(utils, 'getSuites').mockResolvedValue([getTestSuite()])

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
        })

        test('unable to trigger tests', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = mockApi({
            getTest: async () => getApiTest('123-456-789'),
            triggerTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          })
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
          jest.spyOn(utils, 'getSuites').mockResolvedValue([getTestSuite()])

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.triggerTests).toHaveBeenCalledTimes(1)
        })

        test('unable to poll test results', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = mockApi({
            getBatch: async () => ({results: [], status: 'passed'}),
            getTest: async () => getApiTest('123-456-789'),
            pollResults: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
            triggerTests: async () => mockTestTriggerResponse,
          })
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
          jest.spyOn(utils, 'getSuites').mockResolvedValue([getTestSuite()])

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.pollResults).toHaveBeenCalledTimes(1)
        })
      })
    })
  })

  describe('exit code respects `failOnMissingTests`', () => {
    const cases: [string, boolean, number, string[]][] = [
      ['only missing tests', false, 0, ['mis-sin-ggg']],
      ['only missing tests', true, 1, ['mis-sin-ggg']],
      ['both missing and available tests', false, 0, ['mis-sin-ggg', 'abc-def-ghi']],
      ['both missing and available tests', true, 1, ['mis-sin-ggg', 'abc-def-ghi']],
    ]

    test.each(cases)(
      '%s with failOnMissingTests=%s exits with %s',
      async (_: string, failOnMissingTests: boolean, exitCode: number, tests: string[]) => {
        const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
        command['config'].failOnMissingTests = failOnMissingTests

        const apiHelper = mockApi({
          getTest: jest.fn(async (testId: string) => {
            if (testId === 'mis-sin-ggg') {
              throw getAxiosHttpError(404, {errors: ['Test not found']})
            }

            return {} as ServerTest
          }),
        })
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
        jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
        jest.spyOn(utils, 'getSuites').mockResolvedValue([
          {
            content: {
              tests: tests.map((testId) => ({config: {}, id: testId})),
            },
            name: 'Suite 1',
          },
        ])

        expect(await command.execute()).toBe(exitCode)
        expect(apiHelper.getTest).toHaveBeenCalledTimes(tests.length)
      }
    )
  })

  describe('API errors logging', () => {
    test('enough context is provided', async () => {
      const writeMock = jest.fn()

      const command = createCommand(RunTestsCommand, {stdout: {write: writeMock}})
      command['config'].failOnCriticalErrors = true

      const apiHelper = mockApi({
        getTest: jest.fn(async (testId: string) => {
          if (testId === 'for-bid-den') {
            const serverError = getAxiosHttpError(403, {errors: ['Forbidden']})
            serverError.config.url = 'tests/for-bid-den'
            throw serverError
          }

          return {name: testId} as ServerTest
        }),
      })
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
      jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
      jest.spyOn(utils, 'getSuites').mockResolvedValue([
        {
          content: {
            tests: [
              {testOverrides: {}, id: 'aaa-aaa-aaa'},
              {testOverrides: {headers: {}}, id: 'bbb-bbb-bbb'}, // 1 test override
              {testOverrides: {}, id: 'for-bid-den'},
            ],
          },
          name: 'Suite 1',
        },
      ])

      expect(await command.execute()).toBe(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(3)

      expect(writeMock).toHaveBeenCalledTimes(4)
      expect(writeMock).toHaveBeenCalledWith('[aaa-aaa-aaa] Found test "aaa-aaa-aaa"\n')
      expect(writeMock).toHaveBeenCalledWith('[bbb-bbb-bbb] Found test "bbb-bbb-bbb" (1 test override)\n')
      expect(writeMock).toHaveBeenCalledWith(
        '\n ERROR: authorization error \nFailed to get test: query on https://app.datadoghq.com/tests/for-bid-den returned: "Forbidden"\n\n\n'
      )
      expect(writeMock).toHaveBeenCalledWith(
        'Credentials refused, make sure `apiKey`, `appKey` and `datadogSite` are correct.\n'
      )
    })
  })
})

describe('upload-application', () => {
  beforeEach(() => {
    process.env = {}
    jest.restoreAllMocks()
  })

  describe('resolveConfig', () => {
    beforeEach(() => {
      process.env = {}
    })

    test('override from ENV', async () => {
      const overrideEnv = {
        DATADOG_API_KEY: 'fake_api_key',
        DATADOG_APP_KEY: 'fake_app_key',
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config.json',
        DATADOG_SYNTHETICS_VERSION_NAME: 'new',
        DATADOG_SYNTHETICS_LATEST: 'true',
      }

      process.env = overrideEnv
      const command = createCommand(UploadApplicationCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_UPLOAD_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: overrideEnv.DATADOG_SITE,
        versionName: overrideEnv.DATADOG_SYNTHETICS_VERSION_NAME,
        latest: toBoolean(overrideEnv.DATADOG_SYNTHETICS_LATEST),
      })
    })

    test('override from config file', async () => {
      const overrideConfigFile: UploadApplicationCommandConfig = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/upload-app-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        proxy: {protocol: 'http'},
        mobileApplicationVersionFilePath: 'fake_path/fake_app.apk',
        mobileApplicationId: 'fake-abc',
        versionName: 'new',
        latest: true,
      }

      const command = createCommand(UploadApplicationCommand)
      command['configPath'] = 'src/commands/synthetics/__tests__/config-fixtures/upload-app-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(overrideConfigFile)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<UploadApplicationCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        mobileApplicationVersionFilePath: 'fake_path/cli_fake_app.apk',
        mobileApplicationId: 'fake-abc-cli',
        versionName: 'new cli',
        latest: true,
      }

      const command = createCommand(UploadApplicationCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['mobileApplicationVersionFilePath'] = overrideCLI.mobileApplicationVersionFilePath
      command['mobileApplicationId'] = overrideCLI.mobileApplicationId
      command['versionName'] = overrideCLI.versionName
      command['latest'] = overrideCLI.latest

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_UPLOAD_COMMAND_CONFIG,
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        mobileApplicationVersionFilePath: 'fake_path/cli_fake_app.apk',
        mobileApplicationId: 'fake-abc-cli',
        versionName: 'new cli',
        latest: true,
      })
    })

    test('override from config file < ENV < CLI', async () => {
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
        ...baseConfig,
        apiKey: 'api_key_config_file',
        appKey: 'app_key_config_file',
        datadogSite: 'us5.datadoghq.com',
        mobileApplicationVersionFilePath: 'fake_path/fake_app.apk',
        mobileApplicationId: 'fake-abc',
        versionName: 'new',
        latest: true,
      }))

      process.env = {
        DATADOG_API_KEY: 'api_key_env',
        DATADOG_APP_KEY: 'app_key_env',
      }

      const command = createCommand(UploadApplicationCommand)
      command['apiKey'] = 'api_key_cli'
      command['mobileApplicationVersionFilePath'] = './path/to/application_cli.apk'

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_UPLOAD_COMMAND_CONFIG,
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'us5.datadoghq.com',
        mobileApplicationVersionFilePath: './path/to/application_cli.apk',
        mobileApplicationId: 'fake-abc',
        versionName: 'new',
        latest: true,
      })
    })
  })
})
