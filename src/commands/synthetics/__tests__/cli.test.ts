import {Cli} from 'clipanion/lib/advanced'

import {createCommand} from '../../../helpers/__tests__/fixtures'
import * as ciUtils from '../../../helpers/utils'

import * as api from '../api'
import {UserConfigOverride} from '../interfaces'
import {DEFAULT_COMMAND_CONFIG, DEFAULT_POLLING_TIMEOUT, RunTestsCommand} from '../run-tests-command'
import {DEFAULT_UPLOAD_COMMAND_CONFIG, UploadApplicationCommand} from '../upload-application-command'
import * as utils from '../utils'

import {getApiTest, getAxiosHttpError, getTestSuite, mockTestTriggerResponse} from './fixtures'
test('all option flags are supported', async () => {
  const options = [
    'apiKey',
    'appKey',
    'config',
    'datadogSite',
    'failOnCriticalErrors',
    'failOnMissingTests',
    'failOnTimeout',
    'files',
    'jUnitReport',
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
      }

      process.env = overrideEnv
      const command = createCommand(RunTestsCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        datadogSite: overrideEnv.DATADOG_SITE,
        global: {pollingTimeout: DEFAULT_POLLING_TIMEOUT},
        subdomain: overrideEnv.DATADOG_SUBDOMAIN,
      })
    })

    test('override from config file', async () => {
      const overrideConfigFile = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['my-new-file'],
        global: {
          locations: [],
          pollingTimeout: 2,
          mobileApplicationVersionFilePath: './path/to/application.apk',
        },
        locations: [],
        pollingTimeout: 1,
        proxy: {protocol: 'https'},
        publicIds: ['ran-dom-id'],
        selectiveRerun: false,
        subdomain: 'ppa',
        tunnel: true,
        variableStrings: [],
      }

      const command = createCommand(RunTestsCommand)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(overrideConfigFile)
    })

    test('override from CLI', async () => {
      const overrideCLI = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        mobileApplicationVersionFilePath: './path/to/application.apk',
        publicIds: ['ran-dom-id'],
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      }

      const command = createCommand(RunTestsCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
      command['failOnMissingTests'] = overrideCLI.failOnMissingTests
      command['failOnTimeout'] = overrideCLI.failOnTimeout
      command['files'] = overrideCLI.files
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
        global: {
          pollingTimeout: DEFAULT_POLLING_TIMEOUT,
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
          pollingTimeout: 333,
          mobileApplicationVersionFilePath: './path/to/application_cli.apk',
        },
      })
    })

    test('parameters override precedence: global < ENV < test file', async () => {
      const triggerTests = jest.fn(() => {
        throw getAxiosHttpError(502, {message: 'Bad Gateway'})
      })

      const apiHelper = {
        getTest: jest.fn(() => ({...getApiTest('publicId')})),
        triggerTests,
      }

      const getExpectedTestsToTriggerArguments = (
        config: Partial<UserConfigOverride>
      ): Parameters<typeof utils['getTestsToTrigger']> => {
        return [
          // Parameters we care about.
          (apiHelper as unknown) as api.APIHelper,
          [{suite: 'Suite 1', id: 'publicId', config}],

          // Ignore the rest of the parameters.
          expect.anything(),
          expect.anything(),
          expect.anything(),
          expect.anything(),
        ]
      }

      const getTestsToTriggerMock = jest.spyOn(utils, 'getTestsToTrigger')

      const write = jest.fn()
      const command = createCommand(RunTestsCommand, {stderr: {write}} as any)

      // Test file (empty config for now)
      const testFile = {name: 'Suite 1', content: {tests: [{id: 'publicId', config: {}}]}}
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [testFile]) as any)
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      // Global
      command['config'].global = {
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
      testFile.content.tests[0].config = {
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
        global: {followRedirects: false, pollingTimeout: 333},
        pollingTimeout: 333,
      })
    })
  })

  describe('exit code respects `failOnCriticalErrors`', () => {
    test('404 leading to `NO_TESTS_TO_RUN` never exits with 1', async () => {
      const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
      command['config'].failOnCriticalErrors = true

      const apiHelper = {
        getTest: jest.fn(() => {
          throw getAxiosHttpError(404, {errors: ['Test not found']})
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

      expect(await command.execute()).toBe(0)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
    })

    describe.each([false, true])('%s', (failOnCriticalErrors: boolean) => {
      const cases: [string, number?][] = [['HTTP 4xx error', 403], ['HTTP 5xx error', 502], ['Unknown error']]
      const expectedExit = failOnCriticalErrors ? 1 : 0

      describe.each(cases)('%s', (_, errorCode) => {
        test('unable to obtain test configurations', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
          command['config'].failOnCriticalErrors = failOnCriticalErrors
          command['testSearchQuery'] = 'test:search'

          const apiHelper = {
            searchTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          }
          jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.searchTests).toHaveBeenCalledTimes(1)
        })

        test('unavailable test config', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getTest: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          }
          jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
        })

        test('unable to trigger tests', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getTest: () => getApiTest('123-456-789'),
            triggerTests: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
          }
          jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

          expect(await command.execute()).toBe(expectedExit)
          expect(apiHelper.triggerTests).toHaveBeenCalledTimes(1)
        })

        test('unable to poll test results', async () => {
          const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
          command['config'].failOnCriticalErrors = failOnCriticalErrors

          const apiHelper = {
            getBatch: () => ({results: [], status: 'success'}),
            getTest: () => getApiTest('123-456-789'),
            pollResults: jest.fn(() => {
              throw errorCode ? getAxiosHttpError(errorCode, {message: 'Error'}) : new Error('Unknown error')
            }),
            triggerTests: () => mockTestTriggerResponse,
          }
          jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
          jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
          jest.spyOn(utils, 'getSuites').mockImplementation((() => [getTestSuite()]) as any)

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
      async (_: string, failOnMissingTests: boolean, exitCode: number, tests: (string | null)[]) => {
        const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}} as any)
        command['config'].failOnMissingTests = failOnMissingTests

        const apiHelper = {
          getTest: jest.fn((testId: string) => {
            if (testId === 'mis-sin-ggg') {
              throw getAxiosHttpError(404, {errors: ['Test not found']})
            }

            return {}
          }),
        }
        jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
        jest.spyOn(utils, 'getSuites').mockImplementation((() => [
          {
            content: {
              tests: tests.map((testId) => ({config: {}, id: testId})),
            },
            name: 'Suite 1',
          },
        ]) as any)

        expect(await command.execute()).toBe(exitCode)
        expect(apiHelper.getTest).toHaveBeenCalledTimes(tests.length)
      }
    )
  })

  describe('API errors logging', () => {
    test('enough context is provided', async () => {
      const writeMock = jest.fn()

      const command = createCommand(RunTestsCommand, {stdout: {write: writeMock}} as any)
      command['config'].failOnCriticalErrors = true

      const apiHelper = {
        getTest: jest.fn((testId: string) => {
          if (testId === 'for-bid-den') {
            const serverError = getAxiosHttpError(403, {errors: ['Forbidden']})
            serverError.config.url = 'tests/for-bid-den'
            throw serverError
          }

          return {name: testId}
        }),
      }
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, __) => config)
      jest.spyOn(utils, 'getSuites').mockImplementation((() => [
        {
          content: {
            tests: [
              {config: {}, id: 'aaa-aaa-aaa'},
              {config: {}, id: 'bbb-bbb-bbb'},
              {config: {}, id: 'for-bid-den'},
            ],
          },
          name: 'Suite 1',
        },
      ]) as any)

      expect(await command.execute()).toBe(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(3)

      expect(writeMock).toHaveBeenCalledTimes(4)
      expect(writeMock).toHaveBeenCalledWith('[aaa-aaa-aaa] Found test "aaa-aaa-aaa" (1 config override)\n')
      expect(writeMock).toHaveBeenCalledWith('[bbb-bbb-bbb] Found test "bbb-bbb-bbb" (1 config override)\n')
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

    test('override from config file', async () => {
      const overrideConfigFile = {
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
      const overrideCLI = {
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
