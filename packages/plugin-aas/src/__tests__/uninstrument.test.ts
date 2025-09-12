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
  deleteSiteContainer: jest.fn(),
  listApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
}

jest.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: jest.fn().mockImplementation(() => ({
    webApps: webAppsOperations,
  })),
}))

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {UninstrumentCommand} from '../uninstrument'

import {CONTAINER_WEB_APP, DEFAULT_ARGS} from './common'

describe('aas instrument', () => {
  const runCLI = makeRunCLI(UninstrumentCommand, ['aas', 'uninstrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.get.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.deleteSiteContainer.mockReset().mockResolvedValue(undefined)
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue(undefined)
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
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          hello: 'world', // existing setting to ensure we don't remove it
        },
      })
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])
      expect(context.stdout.toString()).toEqual(`[Dry Run] 🐶 Beginning uninstrumentation of Azure App Service(s)
[Dry Run] Removing sidecar container datadog-sidecar from my-web-app (if it exists)
[Dry Run] Checking Application Settings on my-web-app
[Dry Run] Updating Application Settings for my-web-app
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
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          hello: 'world', // existing setting to ensure we don't remove it
        },
      })
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
Updating Application Settings for my-web-app
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
    })

    test('Uninstrument sidecar and updates app settings with .NET settings', async () => {
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          hello: 'world',
          foo: 'bar',
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
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
    })

    test('Uninstrument sidecar and updates custom app settings from config', async () => {
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({
        properties: {
          hello: 'world',
          foo: 'bar',
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SOME_FEATURE: 'true',
        },
      })
      const {code, context} = await runCLI([...DEFAULT_ARGS, '-e', 'DD_SOME_FEATURE=true'])
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
Removing sidecar container datadog-sidecar from my-web-app (if it exists)
Checking Application Settings on my-web-app
Updating Application Settings for my-web-app
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
    })

    test('Warns and exits if App Service is not Linux', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({...CONTAINER_WEB_APP, kind: 'app,windows'})
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning uninstrumentation of Azure App Service(s)
[!] Unable to instrument my-web-app. Only Linux-based Azure App Services are currently supported.
Please see the documentation for information on
how to instrument Windows-based App Services:
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows
🐶 Uninstrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.deleteSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
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
    })
  })
})
