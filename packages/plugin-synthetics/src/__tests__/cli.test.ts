import {createCommand, getAxiosError} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import * as ciUtils from '@datadog/datadog-ci-base/helpers/utils'

import * as api from '../api'
import {DeployTestsCommand} from '../deploy-tests-command'
import {CriticalError} from '../errors'
import {ImportTestsCommand} from '../import-tests-command'
import {
  DeployTestsCommandConfig,
  ImportTestsCommandConfig,
  MobileAppUploadResult,
  UploadApplicationCommandConfig,
} from '../interfaces'
import * as mobile from '../mobile'
import {UploadApplicationCommand} from '../upload-application-command'

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
        ...UploadApplicationCommand.getDefaultConfig(),
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
        configPath: 'src/__tests__/config-fixtures/upload-app-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        proxy: {protocol: 'http'},
        mobileApplicationVersionFilePath: 'fake_path/fake_app.apk',
        mobileApplicationId: 'fake-abc',
        versionName: 'new',
        latest: true,
      }

      const command = createCommand(UploadApplicationCommand)
      command['configPath'] = 'src/__tests__/config-fixtures/upload-app-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<UploadApplicationCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...UploadApplicationCommand.getDefaultConfig(),
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...UploadApplicationCommand.getDefaultConfig(),
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

  describe('reporting version UUID', () => {
    test('UUID is reported when present', async () => {
      jest.spyOn(mobile, 'uploadMobileApplicationVersion').mockResolvedValue({
        valid_app_result: {
          app_version_uuid: 'fake-uuid',
        },
      } as MobileAppUploadResult)

      const writeMock = jest.fn()
      const command = createCommand(UploadApplicationCommand, {stdout: {write: writeMock}})

      expect(await command['execute']()).toBe(0)
      expect(writeMock).toHaveBeenCalledWith(expect.stringContaining('The new version has version ID: fake-uuid'))
    })

    test('the command fails when no UUID is present', async () => {
      jest.spyOn(mobile, 'uploadMobileApplicationVersion').mockResolvedValue({
        valid_app_result: undefined,
      } as MobileAppUploadResult)

      const writeMock = jest.fn()
      const command = createCommand(UploadApplicationCommand, {stdout: {write: writeMock}})

      expect(await command['execute']()).toBe(1)
      expect(writeMock).toHaveBeenCalledWith(
        expect.stringContaining('The upload was successful, but the version ID is missing.')
      )
    })
  })

  describe('any kind of error is reported', () => {
    test.each([
      [
        'CI error',
        new CriticalError('INVALID_MOBILE_APP', 'some message'),
        'A CI error occurred: [INVALID_MOBILE_APP] some message',
      ],
      ['Endpoint error', new api.EndpointError('some message', 404), 'A backend error occurred: some message (404)'],
      [
        'Axios error',
        getAxiosError(400, {message: 'Bad Request'}),
        'An unexpected error occurred: AxiosError: Bad Request\n    at getAxiosError',
      ],
      ['Unknown error', new Error('Unknown error'), 'An unexpected error occurred: Error: Unknown error\n    at '],
    ])('%s', async (_, error, expectedMessage) => {
      const writeMock = jest.fn()
      const command = createCommand(UploadApplicationCommand, {stdout: {write: writeMock}})

      jest.spyOn(mobile, 'uploadMobileApplicationVersion').mockImplementation(() => {
        throw error
      })

      expect(await command['execute']()).toBe(1)

      expect(writeMock).toHaveBeenCalledWith(expect.stringContaining(expectedMessage))
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
        ...ImportTestsCommand.getDefaultConfig(),
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
        configPath: 'src/__tests__/config-fixtures/import-tests-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        files: ['my-new-file'],
        proxy: {protocol: 'http'},
        publicIds: ['ran-dom-id1'],
        testSearchQuery: 'a-search-query',
      }

      const command = createCommand(ImportTestsCommand)
      command['configPath'] = 'src/__tests__/config-fixtures/import-tests-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<ImportTestsCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...ImportTestsCommand.getDefaultConfig(),
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...ImportTestsCommand.getDefaultConfig(),
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
        ...DeployTestsCommand.getDefaultConfig(),
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
        configPath: 'src/__tests__/config-fixtures/deploy-tests-config-with-all-keys.json',
        datadogSite: 'datadoghq.eu',
        files: ['my-new-file'],
        proxy: {protocol: 'http'},
        publicIds: ['ran-dom-id1'],
        subdomain: 'ppa',
        excludeFields: ['config'],
      }

      const command = createCommand(DeployTestsCommand)
      command['configPath'] = 'src/__tests__/config-fixtures/deploy-tests-config-with-all-keys.json'

      await command['resolveConfig']()
      expect(command['config']).toEqual(expectedConfig)
    })

    test('override from CLI', async () => {
      const overrideCLI: Omit<DeployTestsCommandConfig, 'proxy'> = {
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...DeployTestsCommand.getDefaultConfig(),
        apiKey: 'fake_api_key_cli',
        appKey: 'fake_app_key_cli',
        configPath: 'src/__tests__/config-fixtures/empty-config-file.json',
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
        ...DeployTestsCommand.getDefaultConfig(),
        apiKey: 'api_key_cli',
        appKey: 'app_key_env',
        datadogSite: 'us5.datadoghq.com',
      })
    })
  })
})
