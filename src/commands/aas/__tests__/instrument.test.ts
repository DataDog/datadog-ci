jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFile: jest.fn().mockImplementation((a, b, callback) => callback({code: 'ENOENT'})),
}))

jest.mock('../../../../package.json', () => ({version: 'XXXX'}))

const validateApiKey = jest.fn()
jest.mock('../../../helpers/apikey', () => ({
  newApiKeyValidator: jest.fn().mockImplementation(() => ({
    validateApiKey,
  })),
}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const webAppsOperations = {
  get: jest.fn(),
  listSiteContainers: jest.fn(),
  createOrUpdateSiteContainer: jest.fn(),
  listApplicationSettings: jest.fn(),
  updateApplicationSettings: jest.fn(),
  restart: jest.fn(),
}

jest.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: jest.fn().mockImplementation(() => ({
    webApps: webAppsOperations,
  })),
}))

import {WebSiteManagementClient} from '@azure/arm-appservice'
import {DefaultAzureCredential} from '@azure/identity'

import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {InstrumentCommand} from '../instrument'

import {CONTAINER_WEB_APP, DEFAULT_ARGS, DEFAULT_CONFIG} from './common'

async function* asyncIterable<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
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
      validateApiKey.mockClear().mockResolvedValue(true)
    })

    test('Adds a sidecar and updates the application settings', async () => {
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
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
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
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
        },
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Performs no actions in dry run mode', async () => {
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])
      expect(context.stdout.toString()).toEqual(`[Dry Run] 🐶 Beginning instrumentation of Azure App Service(s)
[Dry Run] Creating sidecar container datadog-sidecar on my-web-app
[Dry Run] Updating Application Settings for my-web-app
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
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Does not restart when specified', async () => {
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--no-restart'])
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Updating Application Settings for my-web-app
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
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
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
        },
      })
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
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
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Fails if datadog API key is invalid', async () => {
      validateApiKey.mockClear().mockResolvedValue(false)

      const {code, context} = await runCLI(DEFAULT_ARGS)
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
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Warns and exits if App Service is not Linux', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({...CONTAINER_WEB_APP, kind: 'app,windows'})
      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
[!] Unable to instrument my-web-app. Only Linux-based Azure App Services are currently supported.
Please see the documentation for information on
how to instrument Windows-based App Services:
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows
🐶 Instrumentation completed with errors, see above for details.
`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar instrumentation', async () => {
      webAppsOperations.createOrUpdateSiteContainer.mockClear().mockRejectedValue(new Error('sidecar error'))
      const {code, context} = await runCLI(DEFAULT_ARGS)
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
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
          image: 'index.docker.io/datadog/serverless-init:latest',
          isMain: false,
          targetPort: '8126',
        }
      )
      // the last operations never get called due to the above failure
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
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
      expect(context.stdout.toString()).toEqual(`🐶 Beginning instrumentation of Azure App Service(s)
Creating sidecar container datadog-sidecar on my-web-app
Creating sidecar container datadog-sidecar on my-web-app2
Updating Application Settings for my-web-app
Updating Application Settings for my-web-app2
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
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
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
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
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
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app2', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
        },
      })
      expect(webAppsOperations.restart).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
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

      client = new WebSiteManagementClient(new DefaultAzureCredential(), '00000000-0000-0000-0000-000000000000')

      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.get.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.listSiteContainers.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainer.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue({})
      webAppsOperations.restart.mockReset().mockResolvedValue({})
    })

    test('creates sidecar if not present and updates app settings', async () => {
      await command.instrumentSidecar(client, DEFAULT_CONFIG, 'rg', 'app')

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith('rg', 'app', 'datadog-sidecar', {
        image: 'index.docker.io/datadog/serverless-init:latest',
        targetPort: '8126',
        isMain: false,
        environmentVariables: expect.arrayContaining([
          {name: 'DD_API_KEY', value: 'DD_API_KEY'},
          {name: 'DD_SITE', value: 'DD_SITE'},
          {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
        ]),
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('rg', 'app', {
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })
    })

    test('adds .NET settings when the config option is specified', async () => {
      await command.instrumentSidecar(client, {...DEFAULT_CONFIG, isDotnet: true}, 'rg', 'app')

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalledWith('rg', 'app', 'datadog-sidecar', {
        image: 'index.docker.io/datadog/serverless-init:latest',
        targetPort: '8126',
        isMain: false,
        environmentVariables: expect.arrayContaining([
          {name: 'DD_API_KEY', value: 'DD_API_KEY'},
          {name: 'DD_SITE', value: 'DD_SITE'},
          {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
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
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
        })
      )
      webAppsOperations.listApplicationSettings.mockResolvedValue({properties: {}})
      webAppsOperations.createOrUpdateSiteContainer.mockResolvedValue({})
      webAppsOperations.updateApplicationSettings.mockResolvedValue({})

      await command.instrumentSidecar(client, DEFAULT_CONFIG, 'rg', 'app')

      expect(webAppsOperations.createOrUpdateSiteContainer).toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalled()
    })

    test('does not update sidecar if config is correct', async () => {
      webAppsOperations.listSiteContainers.mockReturnValue(
        asyncIterable({
          name: 'datadog-sidecar',
          image: 'index.docker.io/datadog/serverless-init:latest',
          targetPort: '8126',
          environmentVariables: [
            {name: 'DD_API_KEY', value: 'DD_API_KEY'},
            {name: 'DD_SITE', value: 'DD_SITE'},
            {name: 'DD_AAS_INSTANCE_LOGGING_ENABLED', value: 'DD_AAS_INSTANCE_LOGGING_ENABLED'},
          ],
        })
      )
      webAppsOperations.listApplicationSettings.mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG, 'rg', 'app')
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })

    test('does not call Azure APIs in dry run mode', async () => {
      command.dryRun = true
      webAppsOperations.listSiteContainers.mockReturnValue(asyncIterable())
      webAppsOperations.listApplicationSettings.mockResolvedValue({properties: {}})

      await command.instrumentSidecar(client, DEFAULT_CONFIG, 'rg', 'app')

      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })

    test('does not update app settings if no changes needed', async () => {
      webAppsOperations.listSiteContainers.mockReturnValue(asyncIterable())
      webAppsOperations.listApplicationSettings.mockResolvedValue({
        properties: {
          DD_API_KEY: process.env.DD_API_KEY,
          DD_SITE: 'datadoghq.com',
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG, 'rg', 'app')

      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })
  })
})
