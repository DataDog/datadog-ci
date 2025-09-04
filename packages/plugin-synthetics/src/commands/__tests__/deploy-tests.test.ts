import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as ciUtils from '@datadog/datadog-ci-base/helpers/utils'

import {PluginCommand as DeployTestsCommand} from '../../commands/deploy-tests'
import {DeployTestsCommandConfig} from '../../interfaces'

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
