import {Cli} from 'clipanion/lib/advanced'

import {createCommand, getAxiosError} from '../../../helpers/__tests__/fixtures'
import {toBoolean, toNumber, toStringMap} from '../../../helpers/env'
import * as ciUtils from '../../../helpers/utils'

import * as api from '../api'
import {DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG, DeployTestsCommand} from '../deploy-tests-command'
import {DEFAULT_IMPORT_TESTS_COMMAND_CONFIG, ImportTestsCommand} from '../import-tests-command'
import {
  CookiesObject,
  DeployTestsCommandConfig,
  ExecutionRule,
  ImportTestsCommandConfig,
  RunTestsCommandConfig,
  ServerTest,
  UploadApplicationCommandConfig,
  UserConfigOverride,
} from '../interfaces'
import {DEFAULT_COMMAND_CONFIG, RunTestsCommand} from '../run-tests-command'
import {DEFAULT_UPLOAD_COMMAND_CONFIG, UploadApplicationCommand} from '../upload-application-command'
import {toExecutionRule} from '../utils/internal'
import * as utils from '../utils/public'

import {getApiTest, getTestSuite, mockApi, mockTestTriggerResponse} from './fixtures'
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
        DATADOG_SYNTHETICS_BATCH_TIMEOUT: '1',
        DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config.json',
        DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS: 'false',
        DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS: 'false',
        DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT: 'false',
        DATADOG_SYNTHETICS_FILES: 'test-file1;test-file2;test-file3',
        DATADOG_SYNTHETICS_JUNIT_REPORT: 'junit-report.xml',
        // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
        DATADOG_SYNTHETICS_LOCATIONS: 'Wonderland;FarFarAway',
        DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id;another-public-id',
        DATADOG_SYNTHETICS_SELECTIVE_RERUN: 'true',
        DATADOG_SYNTHETICS_TEST_SEARCH_QUERY: 'a-search-query',
        DATADOG_SYNTHETICS_TUNNEL: 'false',
        DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES: 'true',
        DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD: 'password',
        DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME: 'username',
        DATADOG_SYNTHETICS_OVERRIDE_BODY: 'body',
        DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE: 'bodyType',
        DATADOG_SYNTHETICS_OVERRIDE_COOKIES: 'cookie1;cookie2;cookie3',
        DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND: 'true',
        DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES:
          'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
        DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND: 'true',
        DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT: '42',
        DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS: 'chrome.laptop_large',
        DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE: 'BLOCKING',
        DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS: 'true',
        DATADOG_SYNTHETICS_OVERRIDE_HEADERS: "{'Content-Type': 'application/json', 'Authorization': 'Bearer token'}",
        DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS: 'us-east-1;us-west-1',
        DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION: '00000000-0000-0000-0000-000000000000',
        DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES: 'regex1;regex2',
        DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT: '5',
        DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL: '100',
        DATADOG_SYNTHETICS_OVERRIDE_START_URL: 'startUrl',
        DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX: 'startUrlSubstitutionRegex',
        DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT: '42',
        DATADOG_SYNTHETICS_OVERRIDE_VARIABLES: "{'var1': 'value1', 'var2': 'value2'}",
      }

      process.env = overrideEnv
      const command = createCommand(RunTestsCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        batchTimeout: 1,
        configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: overrideEnv.DATADOG_SITE,
        defaultTestOverrides: {
          allowInsecureCertificates: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES),
          basicAuth: {
            password: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD,
            username: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME,
          },
          body: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BODY,
          bodyType: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE,
          cookies: {
            value: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_COOKIES,
            append: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND),
          },
          setCookies: {
            value: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES,
            append: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND),
          },
          defaultStepTimeout: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT),
          deviceIds: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS.split(';'),
          executionRule: toExecutionRule(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE),
          followRedirects: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS),
          headers: toStringMap(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_HEADERS),
          locations: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS.split(';'),
          mobileApplicationVersion: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION,
          resourceUrlSubstitutionRegexes: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES?.split(
            ';'
          ),
          retry: {
            count: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT)!,
            interval: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL)!,
          },
          startUrl: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_START_URL,
          startUrlSubstitutionRegex: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX,
          testTimeout: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT),
          variables: toStringMap(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_VARIABLES),
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

    test('partial retryConfig override from ENV retains existing values', async () => {
      const overrideEnv = {
        DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT: '5',
      }
      process.env = overrideEnv
      const command = createCommand(RunTestsCommand)

      command['config'].defaultTestOverrides = {
        ...command['config'].defaultTestOverrides,
        retry: {
          count: 1,
          interval: 42,
        },
      }
      await command['resolveConfig']()

      expect(command['config'].defaultTestOverrides.retry).toEqual({
        count: 5,
        interval: 42,
      })
    })

    test('override from config file', async () => {
      const expectedConfig: RunTestsCommandConfig = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        batchTimeout: 1,
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        defaultTestOverrides: {
          allowInsecureCertificates: true,
          basicAuth: {username: 'test', password: 'test'},
          body: '{"fakeContent":true}',
          bodyType: 'application/json',
          cookies: {
            value: 'name1=value1;name2=value2;',
            append: true,
          },
          setCookies: {
            value: 'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
            append: true,
          },
          defaultStepTimeout: 10000,
          deviceIds: ['chrome.laptop_large'],
          executionRule: ExecutionRule.BLOCKING,
          followRedirects: true,
          headers: {'<NEW_HEADER>': '<NEW_VALUE>'},
          locations: ['aws:us-west-1'],
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
          pollingTimeout: 3,
          resourceUrlSubstitutionRegexes: [
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {count: 2, interval: 300},
          startUrl: '{{URL}}?static_hash={{STATIC_HASH}}',
          startUrlSubstitutionRegex: 's/(https://www.)(.*)/$1extra-$2/',
          testTimeout: 200000,
          variables: {titleVariable: 'new value'},
        },
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['my-new-file'],
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {
          allowInsecureCertificates: true,
          basicAuth: {username: 'test', password: 'test'},
          body: '{"fakeContent":true}',
          bodyType: 'application/json',
          cookies: {
            value: 'name1=value1;name2=value2;',
            append: true,
          },
          setCookies: {
            value: 'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
            append: true,
          },
          defaultStepTimeout: 10000,
          deviceIds: ['chrome.laptop_large'],
          executionRule: ExecutionRule.BLOCKING,
          followRedirects: true,
          headers: {'<NEW_HEADER>': '<NEW_VALUE>'},
          locations: ['aws:us-west-1'],
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
          pollingTimeout: 2, // not overridden (backwards compatibility not supported)
          resourceUrlSubstitutionRegexes: [
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {count: 2, interval: 300},
          startUrl: '{{URL}}?static_hash={{STATIC_HASH}}',
          startUrlSubstitutionRegex: 's/(https://www.)(.*)/$1extra-$2/',
          testTimeout: 200000,
          variables: {titleVariable: 'new value'},
        },
        jUnitReport: 'junit-report.xml',
        // TODO SYNTH-12989: Clean up `locations` that should only be part of test overrides
        locations: [],
        // TODO SYNTH-12989: Clean up `pollingTimeout` in favor of `batchTimeout`
        pollingTimeout: 1,
        proxy: {
          protocol: 'https',
        },
        publicIds: ['ran-dom-id1'],
        selectiveRerun: true,
        subdomain: 'ppa',
        testSearchQuery: 'a-search-query',
        tunnel: true,
        // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
        variableStrings: [],
      }

      const command = createCommand(RunTestsCommand)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
      const overrideCLI: Omit<RunTestsCommandConfig, 'global' | 'defaultTestOverrides' | 'proxy'> = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        batchTimeout: 1, // not used in the first test case
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        jUnitReport: 'junit-report.xml',
        mobileApplicationVersionFilePath: './path/to/application.apk',
        pollingTimeout: 2,
        publicIds: ['ran-dom-id2'],
        selectiveRerun: true,
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
        // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
        variableStrings: ['var3=value3', 'var4=value4'],
      }
      /** Values passed to `--override`. */
      const defaultTestOverrides: UserConfigOverride = {
        allowInsecureCertificates: true,
        basicAuth: {
          password: 'password',
          username: 'username',
        },
        body: 'a body',
        bodyType: 'bodyType',
        cookies: 'name1=value1;name2=value2;',
        setCookies: 'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
        defaultStepTimeout: 42,
        deviceIds: ['chrome.laptop_large', 'chrome.laptop_small', 'firefox.laptop_large'],
        executionRule: ExecutionRule.BLOCKING,
        followRedirects: true,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer token'},
        locations: ['us-east-1', 'us-west-1'],
        mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
        // TODO SYNTH-12989: Clean up `pollingTimeout` from `defaultTestOverrides`
        pollingTimeout: 3,
        resourceUrlSubstitutionRegexes: [
          's/(https://www.)(.*)/$1extra-$2',
          'https://example.com(.*)|http://subdomain.example.com$1',
        ],
        retry: {
          count: 5,
          interval: 42,
        },
        startUrl: 'startUrl',
        startUrlSubstitutionRegex: 'startUrlSubstitutionRegex',
        testTimeout: 42,
        variables: {var1: 'value1', var2: 'value2'},
      }

      const command = createCommand(RunTestsCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      // `command['batchTimeout']` not used in the first test case
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      // TODO SYNTH-12989: Clean up deprecated `--deviceIds` in favor of `--override deviceIds="dev1;dev2;..."`
      command['deviceIds'] = ['my-old-device']
      command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
      command['failOnMissingTests'] = overrideCLI.failOnMissingTests
      command['failOnTimeout'] = overrideCLI.failOnTimeout
      command['files'] = overrideCLI.files
      command['jUnitReport'] = overrideCLI.jUnitReport
      command['mobileApplicationVersion'] = defaultTestOverrides.mobileApplicationVersion
      command['mobileApplicationVersionFilePath'] = overrideCLI.mobileApplicationVersionFilePath
      // TODO SYNTH-12989: Clean up `pollingTimeout` in favor of `batchTimeout`
      command['pollingTimeout'] = overrideCLI.pollingTimeout
      command['publicIds'] = overrideCLI.publicIds
      command['selectiveRerun'] = overrideCLI.selectiveRerun
      command['subdomain'] = overrideCLI.subdomain
      command['tunnel'] = overrideCLI.tunnel
      command['testSearchQuery'] = overrideCLI.testSearchQuery
      // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
      command['variableStrings'] = overrideCLI.variableStrings
      command['overrides'] = [
        `allowInsecureCertificates=${defaultTestOverrides.allowInsecureCertificates}`,
        `basicAuth.password=${defaultTestOverrides.basicAuth?.password}`,
        `basicAuth.username=${defaultTestOverrides.basicAuth?.username}`,
        `body=${defaultTestOverrides.body}`,
        `bodyType=${defaultTestOverrides.bodyType}`,
        `cookies=${defaultTestOverrides.cookies}`,
        `cookies.append=true`,
        `setCookies=${defaultTestOverrides.setCookies}`,
        `setCookies.append=true`,
        `defaultStepTimeout=${defaultTestOverrides.defaultStepTimeout}`,
        `deviceIds=${defaultTestOverrides.deviceIds?.join(';')}`,
        `executionRule=${defaultTestOverrides.executionRule}`,
        `followRedirects=${defaultTestOverrides.followRedirects}`,
        `headers.Content-Type=${defaultTestOverrides.headers ? defaultTestOverrides.headers['Content-Type'] : ''}`,
        `headers.Authorization=${defaultTestOverrides.headers?.Authorization}`,
        `locations=${defaultTestOverrides.locations?.join(';')}`,
        // TODO SYNTH-12989: Clean up `pollingTimeout` in favor of `batchTimeout`
        `pollingTimeout=${defaultTestOverrides.pollingTimeout}`,
        `retry.count=${defaultTestOverrides.retry?.count}`,
        `retry.interval=${defaultTestOverrides.retry?.interval}`,
        `startUrl=${defaultTestOverrides.startUrl}`,
        `startUrlSubstitutionRegex=${defaultTestOverrides.startUrlSubstitutionRegex}`,
        `testTimeout=${defaultTestOverrides.testTimeout}`,
        `resourceUrlSubstitutionRegexes=${defaultTestOverrides.resourceUrlSubstitutionRegexes?.join(';')}`,
        `variables.var1=${defaultTestOverrides.variables?.var1}`,
        `variables.var2=${defaultTestOverrides.variables?.var2}`,
      ]

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        batchTimeout: 2,
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        defaultTestOverrides: {
          allowInsecureCertificates: true,
          basicAuth: {
            password: 'password',
            username: 'username',
          },
          body: 'a body',
          bodyType: 'bodyType',
          cookies: {
            value: 'name1=value1;name2=value2;',
            append: true,
          },
          setCookies: {
            value: 'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
            append: true,
          },
          defaultStepTimeout: 42,
          deviceIds: ['chrome.laptop_large', 'chrome.laptop_small', 'firefox.laptop_large'],
          executionRule: ExecutionRule.BLOCKING,
          followRedirects: true,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer token'},
          locations: ['us-east-1', 'us-west-1'],
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
          // TODO SYNTH-12989: Clean up `pollingTimeout` from `defaultTestOverrides`
          resourceUrlSubstitutionRegexes: [
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {
            count: 5,
            interval: 42,
          },
          startUrl: 'startUrl',
          startUrlSubstitutionRegex: 'startUrlSubstitutionRegex',
          testTimeout: 42,
          variables: {var1: 'value1', var2: 'value2'},
        },
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        jUnitReport: 'junit-report.xml',
        pollingTimeout: 2,
        publicIds: ['ran-dom-id2'],
        selectiveRerun: true,
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      })

      // TODO SYNTH-12989: Merge those 2 test cases when `pollingTimeout` is removed
      command['batchTimeout'] = overrideCLI.batchTimeout // when both are used, `batchTimeout` takes precedence
      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        batchTimeout: 1,
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.eu',
        defaultTestOverrides: {
          allowInsecureCertificates: true,
          basicAuth: {
            password: 'password',
            username: 'username',
          },
          body: 'a body',
          bodyType: 'bodyType',
          cookies: {
            value: 'name1=value1;name2=value2;',
            append: true,
          },
          setCookies: {
            value: 'name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly',
            append: true,
          },
          defaultStepTimeout: 42,
          deviceIds: ['chrome.laptop_large', 'chrome.laptop_small', 'firefox.laptop_large'],
          executionRule: ExecutionRule.BLOCKING,
          followRedirects: true,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer token'},
          locations: ['us-east-1', 'us-west-1'],
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000',
          mobileApplicationVersionFilePath: './path/to/application.apk',
          // TODO SYNTH-12989: Clean up `pollingTimeout` from `defaultTestOverrides`
          resourceUrlSubstitutionRegexes: [
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {
            count: 5,
            interval: 42,
          },
          startUrl: 'startUrl',
          startUrlSubstitutionRegex: 'startUrlSubstitutionRegex',
          testTimeout: 42,
          variables: {
            var1: 'value1',
            var2: 'value2',
          },
        },
        failOnCriticalErrors: true,
        failOnMissingTests: true,
        failOnTimeout: false,
        files: ['new-file'],
        jUnitReport: 'junit-report.xml',
        publicIds: ['ran-dom-id2'],
        pollingTimeout: 1,
        selectiveRerun: true,
        subdomain: 'new-sub-domain',
        testSearchQuery: 'a-search-query',
        tunnel: true,
      })
    })

    // TODO SYNTH-12989: Clean up deprecated `--deviceIds` in favor of `--override deviceIds="dev1;dev2;..."`
    test("CLI parameter '--deviceIds' still works (deprecated)", async () => {
      const command = createCommand(RunTestsCommand)
      command['deviceIds'] = ['dev1', 'dev2']
      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        defaultTestOverrides: {
          deviceIds: ['dev1', 'dev2'],
        },
      })
    })

    // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
    test("CLI parameter '--variable' still works (deprecated)", async () => {
      const command = createCommand(RunTestsCommand)
      command['variableStrings'] = ['var1=value1', 'var2=value2']
      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        defaultTestOverrides: {
          variables: {var1: 'value1', var2: 'value2'},
        },
      })
    })

    test("Root config file 'pollingTimeout' still works (deprecated)", async () => {
      const command = createCommand(RunTestsCommand)
      command.configPath = 'src/commands/synthetics/__tests__/config-fixtures/config-with-global-polling-timeout.json'
      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_COMMAND_CONFIG,
        batchTimeout: 333,
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/config-with-global-polling-timeout.json',
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {followRedirects: false},
        defaultTestOverrides: {followRedirects: false},
        pollingTimeout: 333,
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

    describe('override precedence - [config file < ENV < CLI < test file]', () => {
      const configFile = {
        apiKey: 'config_file_api_key',
        appKey: 'config_file_app_key',
        datadogSite: 'us3.datadoghq.com',
        defaultTestOverrides: {
          allowInsecureCertificates: true,
          basicAuth: {
            username: 'config-file-username',
            password: 'config-file-password',
          },
          body: '{"fakeContentFromConfigFile":true}',
          bodyType: 'application/json-from-config-file',
          cookies: {
            value: 'cookie1-from-config-file=cookie1-value;cookie2-from-config-file=cookie2-value;',
            append: true,
          },
          defaultStepTimeout: 10000,
          deviceIds: ['chrome.laptop_large_from_config_file', 'chrome.laptop_small_from_config_file'],
          executionRule: ExecutionRule.BLOCKING,
          followRedirects: true,
          headers: {'Config-File': 'This is a mess'},
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000-config-file',
          mobileApplicationVersionFilePath: './path/to/application-from-config-file.apk',
          pollingTimeout: 2,
          retry: {count: 2, interval: 300},
          resourceUrlSubstitutionRegexes: ['regex1-from-config-file', 'regex2-from-config-file'],
          startUrl: '{{URL}}?static_hash={{STATIC_HASH}}',
          startUrlSubstitutionRegex: 's/(https://www.)(.*)/$1extra-$2/',
          testTimeout: 200000,
          variables: {titleVariable: 'config file value'},
        },
        failOnCriticalErrors: false,
        failOnMissingTests: false,
        failOnTimeout: false,
        files: ['from_config_file.json'],
        // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
        global: {},
        jUnitReport: 'junit-report-from-config-file.xml',
        // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
        locations: ['location_1_from_config_file', 'location_2_from_config_file'],
        proxy: {protocol: 'http'},
        publicIds: ['public-id-from-config-file'],
        selectiveRerun: false,
        subdomain: 'subdomain_from_config_file',
        testSearchQuery: 'a-search-query-from-config-file',
        tunnel: false,
        // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
        variableStrings: ['configVar1=configValue1', 'configVar2=configValue2'],
      }

      test('config file < ENV', async () => {
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
          ...baseConfig,
          ...configFile,
        }))

        const overrideEnv = {
          DATADOG_API_KEY: 'env_api_key',
          DATADOG_APP_KEY: 'env_app_key',
          DATADOG_SITE: 'us5.datadoghq.com',
          DATADOG_SUBDOMAIN: 'subdomain_from_env',
          DATADOG_SYNTHETICS_BATCH_TIMEOUT: '1',
          DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config_from_env.json',
          DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS: 'true',
          DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS: 'true',
          DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT: 'true',
          DATADOG_SYNTHETICS_FILES: '1_from_env.json;2_from_env.json',
          DATADOG_SYNTHETICS_JUNIT_REPORT: 'junit-report-from-env.xml',
          // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
          DATADOG_SYNTHETICS_LOCATIONS: 'Wonderland;FarFarAway',
          DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id-from-env;another-public-id-from-env',
          DATADOG_SYNTHETICS_SELECTIVE_RERUN: 'true',
          DATADOG_SYNTHETICS_TEST_SEARCH_QUERY: 'a-search-query-from-env',
          DATADOG_SYNTHETICS_TUNNEL: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD: 'password-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME: 'username-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY: 'body-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE: 'bodyType-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES: 'cookie1-from-env;cookie2-from-env;cookie3-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES:
            'cookie1-from-env \n cookie2-from-env; Domain=example.com \n cookie3-from-env; Secure; HttpOnly',
          DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS: 'chrome.laptop_large_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE: 'NON_BLOCKING',
          DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS: 'false',
          DATADOG_SYNTHETICS_OVERRIDE_HEADERS:
            "{'Content-Type': 'application/json', 'Authorization': 'Bearer token from env'}",
          DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS: 'location_1_from_env;location_2_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION: '00000000-0000-0000-0000-000000000000',
          DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES: 'regex1-from-env;regex2-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT: '5',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL: '100',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL: 'startUrl',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX: 'startUrlSubstitutionRegex',
          DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_VARIABLES: "{'var1': 'value1', 'var2': 'value2'}",
        }

        const expectedEnvOverrideResult = {
          apiKey: overrideEnv.DATADOG_API_KEY,
          appKey: overrideEnv.DATADOG_APP_KEY,
          batchTimeout: toNumber(overrideEnv.DATADOG_SYNTHETICS_BATCH_TIMEOUT),
          configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
          datadogSite: overrideEnv.DATADOG_SITE,
          defaultTestOverrides: {
            allowInsecureCertificates: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES),
            basicAuth: {
              password: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD,
              username: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME,
            },
            body: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BODY,
            bodyType: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE,
            cookies: {
              value: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_COOKIES,
              append: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND),
            },
            setCookies: {
              value: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES,
              append: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND),
            },
            defaultStepTimeout: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT),
            deviceIds: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS.split(';'),
            executionRule: toExecutionRule(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE),
            followRedirects: toBoolean(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS),
            headers: toStringMap(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_HEADERS),
            // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
            locations: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS.split(';'),
            mobileApplicationVersion: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION,
            resourceUrlSubstitutionRegexes: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES?.split(
              ';'
            ),
            retry: {
              count: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT),
              interval: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL),
            },
            startUrl: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_START_URL,
            startUrlSubstitutionRegex: overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX,
            testTimeout: toNumber(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT),
            variables: toStringMap(overrideEnv.DATADOG_SYNTHETICS_OVERRIDE_VARIABLES),

            // Added to make the test work, should be changed in the future when cleaning up
            mobileApplicationVersionFilePath: configFile.defaultTestOverrides.mobileApplicationVersionFilePath,
            pollingTimeout: configFile.defaultTestOverrides.pollingTimeout,
          },
          failOnCriticalErrors: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS),
          failOnMissingTests: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS),
          failOnTimeout: toBoolean(overrideEnv.DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT),
          files: overrideEnv.DATADOG_SYNTHETICS_FILES?.split(';'),
          jUnitReport: overrideEnv.DATADOG_SYNTHETICS_JUNIT_REPORT,
          publicIds: overrideEnv.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
          selectiveRerun: toBoolean(overrideEnv.DATADOG_SYNTHETICS_SELECTIVE_RERUN),
          subdomain: overrideEnv.DATADOG_SUBDOMAIN,
          testSearchQuery: overrideEnv.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
          tunnel: toBoolean(overrideEnv.DATADOG_SYNTHETICS_TUNNEL),

          // All the following variables should be removed in the future, as they are either deprecated or misaligned (no ENV variable for now)
          // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
          global: {},
          // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
          locations: configFile.locations,
          pollingTimeout: 1,
          proxy: configFile.proxy,
          variableStrings: configFile.variableStrings,
        }

        process.env = overrideEnv

        const command = createCommand(RunTestsCommand)
        await command['resolveConfig']()
        expect(command['config']).toEqual(expectedEnvOverrideResult)
      })

      test('config file < CLI', async () => {
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
          ...baseConfig,
          ...configFile,
        }))

        const overrideCLI: Omit<RunTestsCommandConfig, 'global' | 'defaultTestOverrides' | 'proxy'> = {
          apiKey: 'cli_api_key',
          appKey: 'cli_app_key',
          batchTimeout: 1,
          configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file-from-cli.json',
          datadogSite: 'datadoghq.eu',
          failOnCriticalErrors: true,
          failOnMissingTests: true,
          failOnTimeout: true,
          files: ['new-file-from-cli'],
          jUnitReport: 'junit-report-from-cli.xml',
          mobileApplicationVersionFilePath: './path/to/application-from-cli.apk',
          pollingTimeout: 10,
          publicIds: ['public-id-from-cli'],
          selectiveRerun: true,
          subdomain: 'subdomain-from-cli',
          testSearchQuery: 'a-search-query-from-cli',
          tunnel: true,
          // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
          variableStrings: ['cliVar3=value3', 'cliVar4=value4'],
        }
        const defaultTestOverrides: UserConfigOverride = {
          allowInsecureCertificates: false,
          basicAuth: {
            password: 'password-cli',
            username: 'username-cli',
          },
          body: '{"fakeContentFromCLI":true}',
          bodyType: 'application/json-from-cli',
          cookies: {
            value: 'cli1=value1;cli2=value2;',
            append: false,
          },
          setCookies: {
            value: 'cli1=value1 \n cli2=value2; Domain=example.com \n cli3=value3; Secure; HttpOnly',
            append: false,
          },
          defaultStepTimeout: 11,
          deviceIds: ['chrome.laptop_large_from_cli', 'chrome.laptop_small_from_cli', 'firefox.laptop_large_from_cli'],
          executionRule: ExecutionRule.NON_BLOCKING,
          followRedirects: false,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer token from cli'},
          locations: ['cli-loc-1', 'cli-loc-2'],
          mobileApplicationVersion: '00000000-0000-0000-0000-000000000000-cli',
          resourceUrlSubstitutionRegexes: [
            'cli-regex',
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {
            count: 13,
            interval: 14,
          },
          startUrl: 'startUrl-from-cli',
          startUrlSubstitutionRegex: 'startUrlSubstitutionRegex-from-cli',
          testTimeout: 15,
          variables: {cliVar1: 'value1', cliVar2: 'value2'},
        }

        const command = createCommand(RunTestsCommand)
        command['apiKey'] = overrideCLI.apiKey
        command['appKey'] = overrideCLI.appKey
        command['batchTimeout'] = overrideCLI.batchTimeout
        command['configPath'] = overrideCLI.configPath
        command['datadogSite'] = overrideCLI.datadogSite
        // TODO SYNTH-12989: Clean up deprecated `--deviceIds` in favor of `--override deviceIds="dev1;dev2;..."`
        command['deviceIds'] = ['my-old-device']
        command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
        command['failOnMissingTests'] = overrideCLI.failOnMissingTests
        command['failOnTimeout'] = overrideCLI.failOnTimeout
        command['files'] = overrideCLI.files
        command['jUnitReport'] = overrideCLI.jUnitReport
        command['mobileApplicationVersion'] = defaultTestOverrides.mobileApplicationVersion
        command['mobileApplicationVersionFilePath'] = overrideCLI.mobileApplicationVersionFilePath
        command['pollingTimeout'] = overrideCLI.pollingTimeout
        command['publicIds'] = overrideCLI.publicIds
        command['selectiveRerun'] = overrideCLI.selectiveRerun
        command['subdomain'] = overrideCLI.subdomain
        command['tunnel'] = overrideCLI.tunnel
        command['testSearchQuery'] = overrideCLI.testSearchQuery
        // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
        command['variableStrings'] = overrideCLI.variableStrings
        command['overrides'] = [
          `allowInsecureCertificates=${defaultTestOverrides.allowInsecureCertificates}`,
          `basicAuth.password=${defaultTestOverrides.basicAuth?.password}`,
          `basicAuth.username=${defaultTestOverrides.basicAuth?.username}`,
          `body=${defaultTestOverrides.body}`,
          `bodyType=${defaultTestOverrides.bodyType}`,
          `cookies=${(defaultTestOverrides.cookies as CookiesObject).value}`,
          `cookies.append=${(defaultTestOverrides.cookies as CookiesObject).append}`,
          `setCookies=${(defaultTestOverrides.setCookies as CookiesObject).value}`,
          `setCookies.append=${(defaultTestOverrides.setCookies as CookiesObject).append}`,
          `defaultStepTimeout=${defaultTestOverrides.defaultStepTimeout}`,
          `deviceIds=${defaultTestOverrides.deviceIds?.join(';')}`,
          `executionRule=${defaultTestOverrides.executionRule}`,
          `followRedirects=${defaultTestOverrides.followRedirects}`,
          `headers.Content-Type=${defaultTestOverrides.headers ? defaultTestOverrides.headers['Content-Type'] : ''}`,
          `headers.Authorization=${defaultTestOverrides.headers?.Authorization}`,
          `locations=${defaultTestOverrides.locations?.join(';')}`,
          `retry.count=${defaultTestOverrides.retry?.count}`,
          `retry.interval=${defaultTestOverrides.retry?.interval}`,
          `startUrl=${defaultTestOverrides.startUrl}`,
          `startUrlSubstitutionRegex=${defaultTestOverrides.startUrlSubstitutionRegex}`,
          `testTimeout=${defaultTestOverrides.testTimeout}`,
          `resourceUrlSubstitutionRegexes=${defaultTestOverrides.resourceUrlSubstitutionRegexes?.join(';')}`,
          `variables.cliVar1=${defaultTestOverrides.variables?.cliVar1}`,
          `variables.cliVar2=${defaultTestOverrides.variables?.cliVar2}`,
        ]

        await command['resolveConfig']()

        // TODO SYNTH-12989: Clean up deprecated `global`, `location`, `variableStrings`, `mobileApplicationVersionFilePath`, `proxy`, etc.
        // This fixes are only here for the test to run, and to maintain backward compatibility.
        const {mobileApplicationVersionFilePath, ...filteredOverrideCLI} = overrideCLI
        const expectedCLIOverrideResult = {
          ...filteredOverrideCLI,
          locations: configFile.locations,
          global: {},
          defaultTestOverrides: {
            ...defaultTestOverrides,
            mobileApplicationVersionFilePath,
            pollingTimeout: configFile.defaultTestOverrides.pollingTimeout,
          },
          pollingTimeout: 1,
          proxy: configFile.proxy,
          variableStrings: configFile.variableStrings,
        }

        expect(command['config']).toEqual(expectedCLIOverrideResult)
      })

      test('ENV < CLI', async () => {
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => baseConfig)

        const overrideEnv = {
          DATADOG_API_KEY: 'env_api_key',
          DATADOG_APP_KEY: 'env_app_key',
          DATADOG_SITE: 'us5.datadoghq.com',
          DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config_from_env.json',
          DATADOG_SUBDOMAIN: 'subdomain_from_env',
          DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS: 'true',
          DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS: 'true',
          DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT: 'true',
          DATADOG_SYNTHETICS_FILES: '1_from_env.json;2_from_env.json',
          DATADOG_SYNTHETICS_JUNIT_REPORT: 'junit-report-from-env.xml',
          // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
          DATADOG_SYNTHETICS_LOCATIONS: 'Wonderland;FarFarAway',
          DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id-from-env;another-public-id-from-env',
          DATADOG_SYNTHETICS_SELECTIVE_RERUN: 'true',
          DATADOG_SYNTHETICS_TEST_SEARCH_QUERY: 'a-search-query-from-env',
          DATADOG_SYNTHETICS_TUNNEL: 'false',
          DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD: 'password-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME: 'username-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY: 'body-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE: 'bodyType-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES: 'cookie1-from-env;cookie2-from-env;cookie3-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND: 'true',
          DATADOG_SYNTHEITCS_OVERRIDE_SET_COOKIES:
            'cookie1-from-env \n cookie2-from-env; Domain=example.com \n cookie3-from-env; Secure; HttpOnly',
          DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS: 'chrome.laptop_large_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE: 'BLOCKING',
          DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_HEADERS:
            "{'Content-Type': 'application/json', 'Authorization': 'Bearer token from env'}",
          DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS: 'location_1_from_env;location_2_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION: 'env-00000000-0000-0000-0000-000000000000',
          DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES: 'env-regex1;env-regex2',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT: '5',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL: '100',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL: 'startUrl-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX: 'startUrlSubstitutionRegex-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_VARIABLES: "{'envVar1': 'value1', 'envVar2': 'value2'}",
        }

        const overrideCLI: Omit<RunTestsCommandConfig, 'global' | 'defaultTestOverrides' | 'proxy'> = {
          apiKey: 'cli_api_key',
          appKey: 'cli_app_key',
          batchTimeout: 1,
          configPath: 'path/to/config_from_cli.json',
          datadogSite: 'datadoghq.eu',
          failOnCriticalErrors: false,
          failOnMissingTests: false,
          failOnTimeout: false,
          files: ['file-from-cli-1;file-from-cli-2'],
          jUnitReport: 'junit-report-from-cli.xml',
          mobileApplicationVersionFilePath: './path/to/application-from-cli.apk',
          pollingTimeout: 10,
          publicIds: ['public-id-from-cli-1', 'public-id-from-cli-2'],
          selectiveRerun: false,
          subdomain: 'subdomain-from-cli',
          testSearchQuery: 'a-search-query-from-cli',
          tunnel: true,
          // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
          variableStrings: ['cliVar3=value3', 'cliVar4=value4'],
        }
        const defaultTestOverrides: UserConfigOverride = {
          allowInsecureCertificates: false,
          basicAuth: {
            password: 'password-cli',
            username: 'username-cli',
          },
          body: 'a body from cli',
          bodyType: 'bodyType from cli',
          cookies: {
            value: 'cli1=value1;cli2=value2;',
            append: false,
          },
          setCookies: {
            value: 'cli1=value1 \n cli2=value2; Domain=example.com \n cli3=value3; Secure; HttpOnly',
            append: false,
          },
          defaultStepTimeout: 11,
          deviceIds: ['chrome.laptop_large_from_cli', 'chrome.laptop_small_from_cli', 'firefox.laptop_large_from_cli'],
          executionRule: ExecutionRule.NON_BLOCKING,
          followRedirects: false,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer token from cli'},
          locations: ['cli-loc-1', 'cli-loc-2'],
          mobileApplicationVersion: 'cli-00000000-0000-0000-0000-000000000000',
          resourceUrlSubstitutionRegexes: [
            'from-cli-regex1',
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {
            count: 13,
            interval: 14,
          },
          startUrl: 'startUrl-from-cli',
          startUrlSubstitutionRegex: 'startUrlSubstitutionRegex-from-cli',
          testTimeout: 15,
          variables: {cliVar1: 'value1', cliVar2: 'value2'},
        }

        process.env = overrideEnv

        const command = createCommand(RunTestsCommand)
        command['apiKey'] = overrideCLI.apiKey
        command['appKey'] = overrideCLI.appKey
        command['batchTimeout'] = overrideCLI.batchTimeout
        command['configPath'] = overrideCLI.configPath
        command['datadogSite'] = overrideCLI.datadogSite
        // TODO SYNTH-12989: Clean up deprecated `--deviceIds` in favor of `--override deviceIds="dev1;dev2;..."`
        command['deviceIds'] = ['my-old-device']
        command['failOnCriticalErrors'] = overrideCLI.failOnCriticalErrors
        command['failOnMissingTests'] = overrideCLI.failOnMissingTests
        command['failOnTimeout'] = overrideCLI.failOnTimeout
        command['files'] = overrideCLI.files
        command['jUnitReport'] = overrideCLI.jUnitReport
        command['mobileApplicationVersion'] = defaultTestOverrides.mobileApplicationVersion
        command['mobileApplicationVersionFilePath'] = overrideCLI.mobileApplicationVersionFilePath
        command['pollingTimeout'] = overrideCLI.pollingTimeout
        command['publicIds'] = overrideCLI.publicIds
        command['selectiveRerun'] = overrideCLI.selectiveRerun
        command['subdomain'] = overrideCLI.subdomain
        command['tunnel'] = overrideCLI.tunnel
        command['testSearchQuery'] = overrideCLI.testSearchQuery
        // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
        command['variableStrings'] = overrideCLI.variableStrings
        command['overrides'] = [
          `allowInsecureCertificates=${defaultTestOverrides.allowInsecureCertificates}`,
          `basicAuth.password=${defaultTestOverrides.basicAuth?.password}`,
          `basicAuth.username=${defaultTestOverrides.basicAuth?.username}`,
          `body=${defaultTestOverrides.body}`,
          `bodyType=${defaultTestOverrides.bodyType}`,
          `cookies=${(defaultTestOverrides.cookies as CookiesObject).value}`,
          `cookies.append=${(defaultTestOverrides.cookies as CookiesObject).append}`,
          `setCookies=${(defaultTestOverrides.setCookies as CookiesObject).value}`,
          `setCookies.append=${(defaultTestOverrides.setCookies as CookiesObject).append}`,
          `defaultStepTimeout=${defaultTestOverrides.defaultStepTimeout}`,
          `deviceIds=${defaultTestOverrides.deviceIds?.join(';')}`,
          `executionRule=${defaultTestOverrides.executionRule}`,
          `followRedirects=${defaultTestOverrides.followRedirects}`,
          `headers.Content-Type=${defaultTestOverrides.headers ? defaultTestOverrides.headers['Content-Type'] : ''}`,
          `headers.Authorization=${defaultTestOverrides.headers?.Authorization}`,
          `locations=${defaultTestOverrides.locations?.join(';')}`,
          `retry.count=${defaultTestOverrides.retry?.count}`,
          `retry.interval=${defaultTestOverrides.retry?.interval}`,
          `startUrl=${defaultTestOverrides.startUrl}`,
          `startUrlSubstitutionRegex=${defaultTestOverrides.startUrlSubstitutionRegex}`,
          `testTimeout=${defaultTestOverrides.testTimeout}`,
          `resourceUrlSubstitutionRegexes=${defaultTestOverrides.resourceUrlSubstitutionRegexes?.join(';')}`,
          `variables.cliVar1=${defaultTestOverrides.variables?.cliVar1}`,
          `variables.cliVar2=${defaultTestOverrides.variables?.cliVar2}`,
        ]

        await command['resolveConfig']()

        // TODO SYNTH-12989: Clean up deprecated `global`, `location`, `variableStrings`, `mobileApplicationVersionFilePath`, `proxy` etc.
        // This fixes are only here for the test to run, and to maintain backward compatibility.
        const {mobileApplicationVersionFilePath, ...filteredOverrideCLI} = overrideCLI
        const expectedCLIOverrideResult = {
          ...filteredOverrideCLI,
          locations: [],
          global: {},
          defaultTestOverrides: {
            ...defaultTestOverrides,
            mobileApplicationVersionFilePath,
          },
          pollingTimeout: 1,
          proxy: {protocol: 'http'},
          variableStrings: [],
        }
        expect(command['config']).toEqual(expectedCLIOverrideResult)
      })

      const overrideTestConfig = {
        allowInsecureCertificates: false,
        basicAuth: {
          password: 'password-test-file',
          username: 'username-test-file',
        },
        body: 'a body from test file',
        bodyType: 'bodyType from test file',
        cookies: {
          value: 'test-file1=value1;test-file2=value2;',
          append: false,
        },
        setCookies: {
          value: 'test-file1=value1 \n test-file2=value2; Domain=example.com \n test-file3=value3; Secure; HttpOnly',
          append: false,
        },
        defaultStepTimeout: 31,
        deviceIds: [
          'chrome.laptop_large_from_test_file',
          'chrome.laptop_small_from_test_file',
          'firefox.laptop_large_from_test_file',
        ],
        executionRule: ExecutionRule.NON_BLOCKING,
        followRedirects: false,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer token from test file'},
        locations: ['test-file-loc-1', 'test-file-loc-2'],
        mobileApplicationVersion: 'test-file-00000000-0000-0000-0000-000000000000',
        pollingTimeout: 32,
        resourceUrlSubstitutionRegexes: [
          'from-test-file-regex1',
          's/(https://www.)(.*)/$1extra-$2',
          'https://example.com(.*)|http://subdomain.example.com$1',
        ],
        retry: {
          count: 33,
          interval: 34,
        },
        startUrl: 'startUrl-from-test-file',
        startUrlSubstitutionRegex: 'startUrlSubstitutionRegex-from-test-file',
        testTimeout: 35,
        variables: {testFileVar1: 'value1', testFileVar2: 'value2'},
      }

      const triggerTests = jest.fn(() => {
        throw getAxiosError(502, {message: 'Bad Gateway'})
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
      const testFile = {name: 'Suite 1', content: {tests: [{id: 'aaa-bbb-ccc', testOverrides: {}}]}}

      test('config file < test file', async () => {
        const getTestsToTriggerMock = jest.spyOn(utils, 'getTestsToTrigger')
        const command = createCommand(RunTestsCommand)
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => {
          return {
            ...baseConfig,
            defaultTestOverrides: {
              ...configFile.defaultTestOverrides,
              mobileApplicationVersionFilePath: undefined,
            },
            testSearchQuery: undefined,
          }
        })
        jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
        jest.spyOn(utils, 'getSuites').mockResolvedValue([testFile])

        testFile.content.tests[0].testOverrides = overrideTestConfig

        expect(await command.execute()).toBe(0)
        expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
          1,
          ...getExpectedTestsToTriggerArguments(overrideTestConfig)
        )
      })
      test('ENV < test file', async () => {
        const getTestsToTriggerMock = jest.spyOn(utils, 'getTestsToTrigger')
        const command = createCommand(RunTestsCommand)
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
        jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
        jest.spyOn(utils, 'getSuites').mockResolvedValue([testFile])

        testFile.content.tests[0].testOverrides = overrideTestConfig

        const testOverrideEnv = {
          DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD: 'password-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME: 'username-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY: 'body-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE: 'bodyType-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES: 'cookie1-from-env;cookie2-from-env;cookie3-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES:
            'cookie1-from-env \n cookie2-from-env; Domain=example.com \n cookie3-from-env; Secure; HttpOnly',
          DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS: 'chrome.laptop_large_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE: 'BLOCKING',
          DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS: 'true',
          DATADOG_SYNTHETICS_OVERRIDE_HEADERS:
            "{'Content-Type': 'application/json', 'Authorization': 'Bearer token from env'}",
          // TODO SYNTH-12989: Clean up `locations` that should only be part of the testOverrides
          DATADOG_SYNTHETICS_LOCATIONS: 'Wonderland;FarFarAway',
          DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS: 'location_1_from_env;location_2_from_env',
          DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION: 'env-00000000-0000-0000-0000-000000000000',
          DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES: 'env-regex1;env-regex2',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT: '5',
          DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL: '100',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL: 'startUrl-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX: 'startUrlSubstitutionRegex-from-env',
          DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT: '42',
          DATADOG_SYNTHETICS_OVERRIDE_VARIABLES: "{'envVar1': 'value1', 'envVar2': 'value2'}",
        }

        process.env = testOverrideEnv

        expect(await command.execute()).toBe(0)
        expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
          1,
          ...getExpectedTestsToTriggerArguments(overrideTestConfig)
        )
      })
      test('CLI < test file', async () => {
        const getTestsToTriggerMock = jest.spyOn(utils, 'getTestsToTrigger')
        const command = createCommand(RunTestsCommand)
        jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementation(async (config, _) => config)
        jest.spyOn(api, 'getApiHelper').mockReturnValue(apiHelper)
        jest.spyOn(utils, 'getSuites').mockResolvedValue([testFile])

        const defaultTestOverrides: UserConfigOverride = {
          allowInsecureCertificates: false,
          basicAuth: {
            password: 'password-cli',
            username: 'username-cli',
          },
          body: 'a body from cli',
          bodyType: 'bodyType from cli',
          cookies: {
            value: 'cli1=value1;cli2=value2;',
            append: false,
          },
          setCookies: {
            value: 'cli1=value1 \n cli2=value2; Domain=example.com \n cli3=value3; Secure; HttpOnly',
            append: false,
          },
          defaultStepTimeout: 11,
          deviceIds: ['chrome.laptop_large_from_cli', 'chrome.laptop_small_from_cli', 'firefox.laptop_large_from_cli'],
          executionRule: ExecutionRule.NON_BLOCKING,
          followRedirects: false,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer token from cli'},
          locations: ['cli-loc-1', 'cli-loc-2'],
          mobileApplicationVersion: 'cli-00000000-0000-0000-0000-000000000000',
          pollingTimeout: 12,
          resourceUrlSubstitutionRegexes: [
            'from-cli-regex1',
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
          retry: {
            count: 13,
            interval: 14,
          },
          startUrl: 'startUrl-from-cli',
          startUrlSubstitutionRegex: 'startUrlSubstitutionRegex-from-cli',
          testTimeout: 15,
          variables: {cliVar1: 'value1', cliVar2: 'value2'},
        }

        // TODO SYNTH-12989: Clean up deprecated `--deviceIds` in favor of `--override deviceIds="dev1;dev2;..."`
        command['deviceIds'] = ['my-old-device']
        command['mobileApplicationVersion'] = defaultTestOverrides.mobileApplicationVersion
        command['overrides'] = [
          `allowInsecureCertificates=${defaultTestOverrides.allowInsecureCertificates}`,
          `basicAuth.password=${defaultTestOverrides.basicAuth?.password}`,
          `basicAuth.username=${defaultTestOverrides.basicAuth?.username}`,
          `body=${defaultTestOverrides.body}`,
          `bodyType=${defaultTestOverrides.bodyType}`,
          `cookies=${(defaultTestOverrides.cookies as CookiesObject).value}`,
          `cookies.append=${(defaultTestOverrides.cookies as CookiesObject).append}`,
          `setCookies=${(defaultTestOverrides.setCookies as CookiesObject).value}`,
          `setCookies.append=${(defaultTestOverrides.setCookies as CookiesObject).append}`,
          `defaultStepTimeout=${defaultTestOverrides.defaultStepTimeout}`,
          `deviceIds=${defaultTestOverrides.deviceIds?.join(';')}`,
          `executionRule=${defaultTestOverrides.executionRule}`,
          `followRedirects=${defaultTestOverrides.followRedirects}`,
          `headers.Content-Type=${defaultTestOverrides.headers ? defaultTestOverrides.headers['Content-Type'] : ''}`,
          `headers.Authorization=${defaultTestOverrides.headers?.Authorization}`,
          `locations=${defaultTestOverrides.locations?.join(';')}`,
          `retry.count=${defaultTestOverrides.retry?.count}`,
          `retry.interval=${defaultTestOverrides.retry?.interval}`,
          `startUrl=${defaultTestOverrides.startUrl}`,
          `startUrlSubstitutionRegex=${defaultTestOverrides.startUrlSubstitutionRegex}`,
          `testTimeout=${defaultTestOverrides.testTimeout}`,
          `resourceUrlSubstitutionRegexes=${defaultTestOverrides.resourceUrlSubstitutionRegexes?.join(';')}`,
          `variables.cliVar1=${defaultTestOverrides.variables?.cliVar1}`,
          `variables.cliVar2=${defaultTestOverrides.variables?.cliVar2}`,
        ]

        await command['resolveConfig']()
        expect(await command.execute()).toBe(0)
        expect(getTestsToTriggerMock).toHaveBeenNthCalledWith(
          1,
          ...getExpectedTestsToTriggerArguments(overrideTestConfig)
        )
      })
    })
  })

  describe('exit code respects `failOnCriticalErrors`', () => {
    test('404 leading to `NO_TESTS_TO_RUN` never exits with 1', async () => {
      const command = createCommand(RunTestsCommand, {stdout: {write: jest.fn()}})
      command['config'].failOnCriticalErrors = true

      const apiHelper = mockApi({
        getTest: jest.fn(() => {
          throw getAxiosError(404, {errors: ['Test not found']})
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
              throw errorCode ? getAxiosError(errorCode, {message: 'Error'}) : new Error('Unknown error')
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
              throw errorCode ? getAxiosError(errorCode, {message: 'Error'}) : new Error('Unknown error')
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
              throw errorCode ? getAxiosError(errorCode, {message: 'Error'}) : new Error('Unknown error')
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
              throw errorCode ? getAxiosError(errorCode, {message: 'Error'}) : new Error('Unknown error')
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
              throw getAxiosError(404, {errors: ['Test not found']})
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
            const serverError = getAxiosError(403, {errors: ['Forbidden']})
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
      const expectedConfig: UploadApplicationCommandConfig = {
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
      expect(command['config']).toEqual(expectedConfig)
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

describe('import-tests', () => {
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
        DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config.json',
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SYNTHETICS_FILES: 'test-file1;test-file2;test-file3',
        DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id;another-public-id',
        DATADOG_SYNTHETICS_TEST_SEARCH_QUERY: 'a-search-query',
      }

      process.env = overrideEnv
      const command = createCommand(ImportTestsCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_IMPORT_TESTS_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: overrideEnv.DATADOG_SITE,
        files: overrideEnv.DATADOG_SYNTHETICS_FILES?.split(';'),
        publicIds: overrideEnv.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
        testSearchQuery: overrideEnv.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
      })
    })

    test('override from config file', async () => {
      const expectedConfig: ImportTestsCommandConfig = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/import-tests-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        files: ['my-new-file'],
        proxy: {protocol: 'http'},
        publicIds: ['ran-dom-id1'],
        testSearchQuery: 'a-search-query',
      }

      const command = createCommand(ImportTestsCommand)
      command['configPath'] = 'src/commands/synthetics/__tests__/config-fixtures/import-tests-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<ImportTestsCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        files: ['new-file'],
        publicIds: ['ran-dom-id2'],
        testSearchQuery: 'a-search-query',
      }

      const command = createCommand(ImportTestsCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['files'] = overrideCLI.files
      command['publicIds'] = overrideCLI.publicIds
      command['testSearchQuery'] = overrideCLI.testSearchQuery

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_IMPORT_TESTS_COMMAND_CONFIG,
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        files: ['new-file'],
        publicIds: ['ran-dom-id2'],
        testSearchQuery: 'a-search-query',
      })
    })

    test('override from config file < ENV < CLI', async () => {
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
        ...baseConfig,
        apiKey: 'api_key_config_file',
        appKey: 'app_key_config_file',
        datadogSite: 'us5.datadoghq.com',
      }))

      process.env = {
        DATADOG_API_KEY: 'api_key_env',
        DATADOG_APP_KEY: 'app_key_env',
      }

      const command = createCommand(ImportTestsCommand)
      command['apiKey'] = 'api_key_cli'

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_IMPORT_TESTS_COMMAND_CONFIG,
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'us5.datadoghq.com',
      })
    })
  })
})

describe('deploy-tests', () => {
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
        DATADOG_SYNTHETICS_CONFIG_PATH: 'path/to/config.json',
        DATADOG_SITE: 'datadoghq.eu',
        DATADOG_SUBDOMAIN: 'custom',
        DATADOG_SYNTHETICS_FILES: 'test-file1;test-file2;test-file3',
        DATADOG_SYNTHETICS_PUBLIC_IDS: 'a-public-id;another-public-id',
      }

      process.env = overrideEnv
      const command = createCommand(DeployTestsCommand)

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG,
        apiKey: overrideEnv.DATADOG_API_KEY,
        appKey: overrideEnv.DATADOG_APP_KEY,
        configPath: overrideEnv.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: overrideEnv.DATADOG_SITE,
        files: overrideEnv.DATADOG_SYNTHETICS_FILES?.split(';'),
        publicIds: overrideEnv.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
        subdomain: overrideEnv.DATADOG_SUBDOMAIN,
      })
    })

    test('override from config file', async () => {
      const expectedConfig: DeployTestsCommandConfig = {
        apiKey: 'fake_api_key',
        appKey: 'fake_app_key',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/deploy-tests-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        files: ['my-new-file'],
        proxy: {protocol: 'http'},
        publicIds: ['ran-dom-id1'],
        subdomain: 'ppa',
      }

      const command = createCommand(DeployTestsCommand)
      command['configPath'] = 'src/commands/synthetics/__tests__/config-fixtures/deploy-tests-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<DeployTestsCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        files: ['new-file'],
        publicIds: ['ran-dom-id2'],
        subdomain: 'subdomain-from-cli',
      }

      const command = createCommand(DeployTestsCommand)
      command['apiKey'] = overrideCLI.apiKey
      command['appKey'] = overrideCLI.appKey
      command['configPath'] = overrideCLI.configPath
      command['datadogSite'] = overrideCLI.datadogSite
      command['files'] = overrideCLI.files
      command['publicIds'] = overrideCLI.publicIds
      command['subdomain'] = overrideCLI.subdomain

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG,
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/commands/synthetics/__tests__/config-fixtures/empty-config-file.json',
        datadogSite: 'datadoghq.cli',
        files: ['new-file'],
        publicIds: ['ran-dom-id2'],
        subdomain: 'subdomain-from-cli',
      })
    })

    test('override from config file < ENV < CLI', async () => {
      jest.spyOn(ciUtils, 'resolveConfigFromFile').mockImplementationOnce(async <T>(baseConfig: T) => ({
        ...baseConfig,
        apiKey: 'api_key_config_file',
        appKey: 'app_key_config_file',
        datadogSite: 'us5.datadoghq.com',
      }))

      process.env = {
        DATADOG_API_KEY: 'api_key_env',
        DATADOG_APP_KEY: 'app_key_env',
      }

      const command = createCommand(DeployTestsCommand)
      command['apiKey'] = 'api_key_cli'

      await command['resolveConfig']()
      expect(command['config']).toEqual({
        ...DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG,
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'us5.datadoghq.com',
      })
    })
  })
})
