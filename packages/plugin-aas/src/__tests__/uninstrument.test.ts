jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFile: jest.fn().mockImplementation((a, b, callback) => callback({code: 'ENOENT'})),
}))

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const webAppsOperations = {
  get: jest.fn(),
  getConfiguration: jest.fn(),
  deleteSiteContainer: jest.fn(),
  listApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
  listSiteExtensions: jest.fn(),
}

const updateTags = jest.fn().mockResolvedValue({})
const deleteAzureResource = jest.fn().mockResolvedValue({})

jest.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: jest.fn().mockImplementation(() => ({
    tagsOperations: {beginCreateOrUpdateAtScopeAndWait: updateTags},
    resources: {beginDeleteByIdAndWait: deleteAzureResource},
  })),
}))

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {PluginCommand as UninstrumentCommand} from '../commands/uninstrument'

import {
  CONTAINER_WEB_APP,
  WINDOWS_DOTNET_WEB_APP,
  WINDOWS_NODE_WEB_APP,
  WINDOWS_JAVA_WEB_APP,
  DEFAULT_ARGS,
  NULL_SUBSCRIPTION_ID,
  WEB_APP_ID,
} from './common'

jest.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: jest.fn().mockImplementation(() => ({
    subscriptionId: NULL_SUBSCRIPTION_ID,
    webApps: webAppsOperations,
  })),
}))

describe('aas instrument', () => {
  const runCLI = makeRunCLI(UninstrumentCommand, ['aas', 'uninstrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.get.mockReset().mockResolvedValue({
        ...CONTAINER_WEB_APP,
        tags: {service: CONTAINER_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockReset().mockResolvedValue(CONTAINER_WEB_APP.siteConfig)
      webAppsOperations.deleteSiteContainer.mockReset().mockResolvedValue(undefined)
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue(undefined)
      webAppsOperations.listSiteExtensions.mockReset().mockResolvedValue([])
      updateTags.mockClear().mockResolvedValue({})
      deleteAzureResource.mockClear().mockResolvedValue({})
    })

    test('Fails if not authenticated with Azure', async () => {
      getToken.mockClear().mockRejectedValue(new Error())

      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`[!] Failed to authenticate with Azure: Error

Please ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run az login to authenticate.

`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.deleteSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })

    test('Dry run uninstrumenting doesnt change settings', async () => {
      updateTags.mockResolvedValue({service: 'my-web-app'})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          hello: 'world', // existing setting to ensure we don't remove it
        },
      })
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])
      expect(context.stdout.toString()).toEqual(`[Dry Run] 🐶 Beginning uninstrumentation of Azure App Service(s)
[Dry Run] Removing sidecar container datadog-sidecar from my-web-app (if it exists)
[Dry Run] Checking Application Settings on my-web-app
[Dry Run] Updating Application Settings for my-web-app
[Dry Run] Updating tags for my-web-app
[Dry Run] 🐶 Uninstrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })

    test('Uninstrument sidecar and updates app settings', async () => {
      webAppsOperations.get.mockResolvedValue({
        ...CONTAINER_WEB_APP,
        tags: {service: 'my-service', env: 'staging', version: '1.0', ava: 'true'},
      })
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          hello: 'world', // existing setting to ensure we don't remove it
        },
      })
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
🐶 Uninstrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world'}, // ensure existing settings are preserved
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {properties: {tags: {ava: 'true'}}})
    })

    test('Uninstrument sidecar and updates app settings with .NET settings', async () => {
      updateTags.mockResolvedValue({service: 'my-web-app'})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          hello: 'world',
          foo: 'bar',
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
      const {code, context} = await runCLI([...DEFAULT_ARGS])
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
🐶 Uninstrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world', foo: 'bar'},
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {properties: {tags: {}}})
    })

    test('Uninstrument sidecar and updates custom app settings from config', async () => {
      updateTags.mockResolvedValue({service: 'my-web-app'})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          hello: 'world',
          foo: 'bar',
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_SERVICE: 'my-web-app',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SOME_FEATURE: 'true',
        },
      })
      const {code, context} = await runCLI([...DEFAULT_ARGS, '-e', 'DD_SOME_FEATURE=true'])
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
Updating Application Settings for my-web-app
Updating tags for my-web-app
🐶 Uninstrumentation completed successfully!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world', foo: 'bar'},
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {properties: {tags: {}}})
    })

    test('Warns and exits if App Service is Windows but runtime cannot be detected', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({...CONTAINER_WEB_APP, kind: 'app,windows'})
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
[!] Unable to detect runtime for Windows App Service my-web-app. Skipping uninstrumentation.
🐶 Uninstrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Removes .NET extension from Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...WINDOWS_DOTNET_WEB_APP,
        tags: {service: WINDOWS_DOTNET_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP.siteConfig)
      webAppsOperations.listApplicationSettings.mockClear().mockResolvedValue({
        properties: {
          DD_API_KEY: 'test-key',
          DD_SITE: 'datadoghq.com',
          hello: 'world',
        },
      })
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toContain('🐶 Beginning uninstrumentation of Azure App Service(s)')
      expect(context.stdout.toString()).toContain('Removing extension Datadog.AzureAppServices.DotNet from my-web-app')
      expect(context.stdout.toString()).toContain('Checking Application Settings on my-web-app')
      expect(context.stdout.toString()).toContain('Updating Application Settings for my-web-app')
      expect(context.stdout.toString()).toContain('Updating tags for my-web-app')
      expect(code).toEqual(0)

      // Verify API calls with correct arguments
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(deleteAzureResource).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.DotNet`,
        '2024-11-01'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world'},
      })
      expect(updateTags).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, expect.objectContaining({
        properties: expect.objectContaining({
          tags: {},
        }),
      }))
    })

    test('Removes Node.js extension from Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...WINDOWS_NODE_WEB_APP,
        tags: {service: WINDOWS_NODE_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue(WINDOWS_NODE_WEB_APP.siteConfig)
      webAppsOperations.listApplicationSettings.mockClear().mockResolvedValue({
        properties: {
          DD_SERVICE: 'my-web-app',
          hello: 'world',
        },
      })
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toContain('Removing extension Datadog.AzureAppServices.Node.Apm from my-web-app')
      expect(code).toEqual(0)

      // Verify API calls
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.Node.Apm`,
        '2024-11-01'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world'},
      })
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Removes Java extension from Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...WINDOWS_JAVA_WEB_APP,
        tags: {service: WINDOWS_JAVA_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue(WINDOWS_JAVA_WEB_APP.siteConfig)
      webAppsOperations.listApplicationSettings.mockClear().mockResolvedValue({
        properties: {
          DD_ENV: 'production',
          hello: 'world',
        },
      })
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toContain('Removing extension Datadog.AzureAppServices.Java.Apm from my-web-app')
      expect(code).toEqual(0)

      // Verify API calls
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.Java.Apm`,
        '2024-11-01'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app', {
        properties: {hello: 'world'},
      })
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Handles extension not found gracefully', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...WINDOWS_DOTNET_WEB_APP,
        tags: {service: WINDOWS_DOTNET_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP.siteConfig)
      webAppsOperations.listApplicationSettings.mockClear().mockResolvedValue({
        properties: {
          DD_API_KEY: 'test-key',
          hello: 'world',
        },
      })
      deleteAzureResource
        .mockClear()
        .mockRejectedValue(new Error('Extension is not installed locally'))
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toContain('Extension Datadog.AzureAppServices.DotNet not found or already removed')
      expect(code).toEqual(0)

      // Verify extension deletion was attempted but error handled gracefully
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledTimes(1)
      expect(deleteAzureResource).toHaveBeenCalledTimes(1)

      // Verify cleanup still proceeds after error
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Dry run mode for Windows extension removal', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({
        ...WINDOWS_DOTNET_WEB_APP,
        tags: {service: WINDOWS_DOTNET_WEB_APP.name},
      })
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP.siteConfig)
      webAppsOperations.listApplicationSettings.mockClear().mockResolvedValue({
        properties: {
          DD_API_KEY: 'test-key',
          hello: 'world',
        },
      })
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])
      expect(context.stdout.toString()).toContain('[Dry Run] Removing extension Datadog.AzureAppServices.DotNet')
      expect(context.stdout.toString()).toContain('[Dry Run] Updating Application Settings')
      expect(code).toEqual(0)

      // Verify read-only operations still happen
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)

      // Verify no write operations occurred
      expect(deleteAzureResource).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Exits properly if the AAS does not exist', async () => {
      webAppsOperations.get
        .mockClear()
        .mockRejectedValue({code: 'ResourceNotFound', details: {message: 'Could not find my-web-app'}})
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
[Error] Failed to uninstrument my-web-app: ResourceNotFound: Could not find my-web-app
🐶 Uninstrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      // the last operations never get called due to the above failure
      expect(webAppsOperations.deleteSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar uninstrumentation', async () => {
      webAppsOperations.listApplicationSettings
        .mockClear()
        .mockRejectedValue({code: 'SettingsError', details: {message: 'unable to list settings'}})
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
[Error] Failed to uninstrument my-web-app: SettingsError: unable to list settings
🐶 Uninstrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      // the last operations never get called due to the above failure
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
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
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app',
      ])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual(`[Error] Invalid AAS resource ID: not-a-valid-resource-id
[Error] Invalid AAS resource ID: another-invalid-id
`)
    })

    test('Instruments multiple App Services in a single subscription', async () => {
      const {code, context} = await runCLI([
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app',
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app2',
      ])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Removing sidecar container datadog-sidecar from my-web-app2 (if it exists)
Checking Application Settings on my-web-app
Checking Application Settings on my-web-app2
No Application Settings changes needed for my-web-app.
No Application Settings changes needed for my-web-app2.
Updating tags for my-web-app
Updating tags for my-web-app2
🐶 Uninstrumentation completed successfully!
`)
      expect(getToken).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.get).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'datadog-sidecar'
      )
      expect(webAppsOperations.deleteSiteContainer).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app2',
        'datadog-sidecar'
      )
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {properties: {tags: {}}})
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID + '2', {properties: {tags: {}}})
    })
  })
})
