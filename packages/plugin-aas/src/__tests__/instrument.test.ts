jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFile: jest.fn().mockImplementation((a, b, callback) => callback({code: 'ENOENT'})),
}))

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const validateApiKey = jest.fn()
jest.mock('@datadog/datadog-ci-base/helpers/apikey', () => ({
  newApiKeyValidator: jest.fn().mockImplementation(() => ({
    validateApiKey,
  })),
}))

const handleSourceCodeIntegration = jest.fn()
jest.mock('@datadog/datadog-ci-base/helpers/serverless/source-code-integration', () => ({
  handleSourceCodeIntegration,
}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const webAppsOperations = {
  get: jest.fn(),
  getConfiguration: jest.fn(),
  listSiteContainers: jest.fn(),
  createOrUpdateSiteContainer: jest.fn(),
  listApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
  restart: jest.fn(),
}

const updateTags = jest.fn().mockResolvedValue({})
const createAzureResource = jest.fn().mockResolvedValue({})

jest.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: jest.fn().mockImplementation(() => ({
    tagsOperations: {beginCreateOrUpdateAtScopeAndWait: updateTags},
    resources: {beginCreateOrUpdateByIdAndWait: createAzureResource},
  })),
}))

import {WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {PluginCommand as InstrumentCommand} from '../commands/instrument'

import {CONTAINER_WEB_APP, DEFAULT_INSTRUMENT_ARGS, DEFAULT_CONFIG, WEB_APP_ID, NULL_SUBSCRIPTION_ID} from './common'

jest.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: jest.fn().mockImplementation(() => ({
    subscriptionId: NULL_SUBSCRIPTION_ID,
    webApps: webAppsOperations,
  })),
}))

async function* asyncIterable<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}

const DEFAULT_CONFIG_WITH_DEFAULT_SERVICE = {
  ...DEFAULT_CONFIG,
  service: DEFAULT_CONFIG.aasName,
}

describe('aas instrument', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['aas', 'instrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.get.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.listSiteContainers.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainer.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue({})
      webAppsOperations.restart.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
      validateApiKey.mockClear().mockResolvedValue(true)
      handleSourceCodeIntegration
        .mockClear()
        .mockResolvedValue('git.commit.sha:test-sha,git.repository_url:test-remote')
    })

    test('Adds a sidecar and updates the application settings and tags', async () => {
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
Restarting Azure App Service my-web-app
🐶 Instrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Performs no actions in dry run mode', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--dry-run'])
      expect(context.stdout.toString()).toEqual(`[Dry Run] 🐶 Beginning instrumentation of Azure App Service(s)
[Dry Run] Creating sidecar container datadog-sidecar on my-web-app
[Dry Run] Updating Application Settings for my-web-app
[Dry Run] Updating tags for my-web-app
[Dry Run] Restarting Azure App Service my-web-app
[Dry Run] 🐶 Instrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Does not restart when specified', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--no-restart'])
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
🐶 Instrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Fails if not authenticated with Azure', async () => {
      getToken.mockClear().mockRejectedValue(new Error())

      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(`[!] Failed to authenticate with Azure: Error

Please ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run az login to authenticate.

`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Fails if datadog API key is invalid', async () => {
      validateApiKey.mockClear().mockResolvedValue(false)

      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(
        `[!] Invalid API Key stored in the environment variable DD_API_KEY: ****************
Ensure you copied the value and not the Key ID.
`
      )
      expect(code).toEqual(1)
      expect(getToken).not.toHaveBeenCalled()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Warns and exits if App Service is Windows but runtime cannot be detected', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({...CONTAINER_WEB_APP, kind: 'app,windows'})
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
[!] Unable to detect runtime for Windows App Service my-web-app. Skipping instrumentation.
🐶 Instrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar instrumentation', async () => {
      webAppsOperations.createOrUpdateSiteContainer.mockClear().mockRejectedValue(new Error('sidecar error'))
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
[Error] Failed to instrument my-web-app: Error: sidecar error
🐶 Instrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      // the last operations never get called due to the above failure
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Errors if no Azure App Service is specified', async () => {
      const {code, context} = await runCLI([])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual('[Error] No App Services specified to instrument\n')
    })

    test('Errors if the resource ID is invalid', async () => {
      const {code, context} = await runCLI(['-r', 'not-a-valid-resource-id'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual('[Error] Invalid AAS resource ID: not-a-valid-resource-id\n')
    })

    test('Errors include all resource IDs that are invalid', async () => {
      const {code, context} = await runCLI([
        '-r',
        'not-a-valid-resource-id',
        '-r',
        'another-invalid-id',
        '-r',
        WEB_APP_ID,
      ])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual(`[Error] Invalid AAS resource ID: not-a-valid-resource-id
[Error] Invalid AAS resource ID: another-invalid-id
`)
    })

    test('Instruments multiple App Services in a single subscription', async () => {
      const {code, context} = await runCLI([
        '-r',
        WEB_APP_ID,
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app2',
        '--no-source-code-integration',
      ])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Creating sidecar container datadog-sidecar on my-web-app2
Updating Application Settings for my-web-app
Updating Application Settings for my-web-app2
Updating tags for my-web-app
Updating tags for my-web-app2
Restarting Azure App Service my-web-app
Restarting Azure App Service my-web-app2
🐶 Instrumentation completed successfully!
`)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app2',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app2', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app2',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID + '2', {
        properties: {tags: {service: 'my-web-app2', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
    })

    test('Adds core tags to the Azure App Service', async () => {
      const {code, context} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--service',
        'my-service',
        '--environment',
        'my-env',
        '--version',
        '1.0.0',
      ])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
Restarting Azure App Service my-web-app
🐶 Instrumentation completed successfully!
`)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'DD_ENV', value: 'DD_ENV'},
            {name: 'DD_VERSION', value: 'DD_VERSION'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-service',
          DD_ENV: 'my-env',
          DD_VERSION: '1.0.0',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {
          tags: {
            service: 'my-service',
            env: 'my-env',
            version: '1.0.0',
            dd_sls_ci: 'vXXXX',
          },
        },
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Sets additional environment variables from config', async () => {
      const {code, context} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--env-vars',
        'CUSTOM_VAR1=value1',
        '--env-vars',
        'CUSTOM_VAR2=value2',
      ])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
Restarting Azure App Service my-web-app
🐶 Instrumentation completed successfully!
`)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'CUSTOM_VAR1', value: 'CUSTOM_VAR1'},
            {name: 'CUSTOM_VAR2', value: 'CUSTOM_VAR2'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SERVICE: 'my-web-app',
          DD_SITE: 'datadoghq.com',
          CUSTOM_VAR1: 'value1',
          CUSTOM_VAR2: 'value2',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Overrides default env vars with additional env vars', async () => {
      const {code} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--env-vars',
        'CUSTOM_VAR1=value1',
        '--env-vars',
        'DD_AAS_INSTANCE_LOGGING_ENABLED=true',
      ])
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar',
        {
          environmentVariables: expect.arrayContaining([
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
            {name: 'CUSTOM_VAR1', value: 'CUSTOM_VAR1'},
          ]),
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SERVICE: 'my-web-app',
          DD_SITE: 'datadoghq.com',
          CUSTOM_VAR1: 'value1',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Adds git metadata tags when source code integration is enabled', async () => {
      const {code} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--source-code-integration', '--upload-git-metadata'])
      expect(code).toEqual(0)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
          DD_TAGS: 'git.commit.sha:test-sha,git.repository_url:test-remote',
        },
      })
    })

    test('Adds extra tags when provided', async () => {
      const {code} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--extra-tags',
        'custom:tag,another:value',
        '--no-source-code-integration',
      ])
      expect(code).toEqual(0)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SERVICE: 'my-web-app',
          DD_SITE: 'datadoghq.com',
          DD_TAGS: 'custom:tag,another:value',
        },
      })
    })

    test('Validates extra tags format', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--extra-tags', 'invalid-tag-format'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain('[Error] Extra tags do not comply with the <key>:<value> array.\n')
    })

    test('Ignores --musl flag and warns on non-containerized dotnet apps', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...CONTAINER_WEB_APP,
        siteConfig: {
          linuxFxVersion: 'DOTNETCORE|9.0',
        },
      })
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--musl', '--dotnet'])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
[!] The --musl flag is set, but the App Service my-web-app is not a containerized app. \
This flag is only applicable for containerized .NET apps (on musl-based distributions like Alpine Linux), and will be ignored.
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
Restarting Azure App Service my-web-app
🐶 Instrumentation completed successfully!
`)
    })
  })

  describe('instrumentSidecar', () => {
    let command: InstrumentCommand
    let client: WebSiteManagementClient

    beforeEach(() => {
      command = new InstrumentCommand()
      // no-dd-sa:typescript-best-practices/no-unsafe-assignment
      command.context = {stdout: {write: jest.fn()}} as any
      command.dryRun = false

      client = new WebSiteManagementClient(new DefaultAzureCredential(), NULL_SUBSCRIPTION_ID)

      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.get.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.listSiteContainers.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainer.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue({})
      webAppsOperations.restart.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('creates sidecar if not present and updates app settings', async () => {
      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', 'app', false)

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith('rg', 'app', 'datadog-sidecar', {
        image: 'index.docker.io/datadog/serverless-init:latest',
        targetPort: '8126',
        isMain: false,
        environmentVariables: expect.arrayContaining([
          {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          {name: 'DD_API_KEY', value: 'DD_API_KEY'},
          {name: 'DD_SITE', value: 'DD_SITE'},
          {name: 'DD_SERVICE', value: 'DD_SERVICE'},
        ]),
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })
    })

    test('adds .NET settings when the config option is specified', async () => {
      await command.instrumentSidecar(
        client,
        {...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, isDotnet: true},
        'rg',
        'app',
        false
      )

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith('rg', 'app', 'datadog-sidecar', {
        image: 'index.docker.io/datadog/serverless-init:latest',
        targetPort: '8126',
        isMain: false,
        environmentVariables: expect.arrayContaining([
          {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          {name: 'DD_API_KEY', value: 'DD_API_KEY'},
          {name: 'DD_SITE', value: 'DD_SITE'},
          {name: 'DD_SERVICE', value: 'DD_SERVICE'},
          {name: 'DD_DOTNET_TRACER_HOME', value: 'DD_DOTNET_TRACER_HOME'},
          {name: 'DD_TRACE_LOG_DIRECTORY', value: 'DD_TRACE_LOG_DIRECTORY'},
          {name: 'CORECLR_ENABLE_PROFILING', value: 'CORECLR_ENABLE_PROFILING'},
          {name: 'CORECLR_PROFILER', value: 'CORECLR_PROFILER'},
          {name: 'CORECLR_PROFILER_PATH', value: 'CORECLR_PROFILER_PATH'},
        ]),
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          CORECLR_ENABLE_PROFILING: '1',
          CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
          CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-x64/Datadog.Trace.ClrProfiler.Native.so',
          DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
          DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        },
      })
    })

    test('adds musl .NET settings when the config options are specified', async () => {
      await command.instrumentSidecar(
        client,
        {...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, isDotnet: true, isMusl: true},
        'rg',
        'app',
        false
      )

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith('rg', 'app', 'datadog-sidecar', {
        image: 'index.docker.io/datadog/serverless-init:latest',
        targetPort: '8126',
        isMain: false,
        environmentVariables: expect.arrayContaining([
          {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          {name: 'DD_API_KEY', value: 'DD_API_KEY'},
          {name: 'DD_SITE', value: 'DD_SITE'},
          {name: 'DD_SERVICE', value: 'DD_SERVICE'},
          {name: 'DD_DOTNET_TRACER_HOME', value: 'DD_DOTNET_TRACER_HOME'},
          {name: 'DD_TRACE_LOG_DIRECTORY', value: 'DD_TRACE_LOG_DIRECTORY'},
          {name: 'CORECLR_ENABLE_PROFILING', value: 'CORECLR_ENABLE_PROFILING'},
          {name: 'CORECLR_PROFILER', value: 'CORECLR_PROFILER'},
          {name: 'CORECLR_PROFILER_PATH', value: 'CORECLR_PROFILER_PATH'},
        ]),
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          CORECLR_ENABLE_PROFILING: '1',
          CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
          CORECLR_PROFILER_PATH: '/home/site/wwwroot/datadog/linux-musl-x64/Datadog.Trace.ClrProfiler.Native.so',
          DD_DOTNET_TRACER_HOME: '/home/site/wwwroot/datadog',
          DD_TRACE_LOG_DIRECTORY: '/home/LogFiles/dotnet',
        },
      })
    })

    test('updates sidecar if present but config is incorrect', async () => {
      webAppsOperations.listSiteContainers.mockReturnValue(
        asyncIterable({
          name: 'datadog-sidecar',
          image: 'wrong-image',
          targetPort: '8126',
          environmentVariables: [
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
          ],
        })
      )
      webAppsOperations.listApplicationSettings.mockResolvedValue({properties: {}})
      webAppsOperations.createOrUpdateSiteContainer.mockResolvedValue({})
      webAppsOperations.updateApplicationSettings.mockResolvedValue({})

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', 'app', false)

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalled()
    })

    test('does not update sidecar if config is correct', async () => {
      webAppsOperations.get.mockResolvedValue({...CONTAINER_WEB_APP, tags: {service: 'my-web-app'}})
      webAppsOperations.listSiteContainers.mockReturnValue(
        asyncIterable({
          name: 'datadog-sidecar',
          image: 'index.docker.io/datadog/serverless-init:latest',
          targetPort: '8126',
          environmentVariables: [
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_SERVICE', value: 'DD_SERVICE'},
          ],
        })
      )
      webAppsOperations.listApplicationSettings.mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', 'app', false)
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('does not call Azure APIs in dry run mode', async () => {
      command.dryRun = true
      webAppsOperations.listSiteContainers.mockReturnValue(asyncIterable())
      webAppsOperations.listApplicationSettings.mockResolvedValue({properties: {}})

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', 'app', false)

      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })

    test('does not update app settings if no changes needed', async () => {
      webAppsOperations.listSiteContainers.mockReturnValue(asyncIterable())
      webAppsOperations.listApplicationSettings.mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', 'app', false)

      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })
  })
})
