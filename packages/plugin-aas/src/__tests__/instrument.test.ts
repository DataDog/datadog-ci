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
  listSiteExtensions: jest.fn(),
  stop: jest.fn(),
  start: jest.fn(),
  restart: jest.fn(),
  getSlot: jest.fn(),
  listSiteContainersSlot: jest.fn(),
  createOrUpdateSiteContainerSlot: jest.fn(),
  listApplicationSettingsSlot: jest.fn(),
  updateApplicationSettingsSlot: jest.fn(),
  listSiteExtensionsSlot: jest.fn(),
  stopSlot: jest.fn(),
  startSlot: jest.fn(),
  restartSlot: jest.fn(),
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

import {
  CONTAINER_WEB_APP,
  WINDOWS_DOTNET_WEB_APP,
  WINDOWS_NODE_WEB_APP,
  WINDOWS_JAVA_WEB_APP,
  DEFAULT_INSTRUMENT_ARGS,
  DEFAULT_CONFIG,
  WEB_APP_ID,
  WEB_APP_SLOT_ID,
  NULL_SUBSCRIPTION_ID,
  SLOT_INSTRUMENT_ARGS,
} from './common'

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
      webAppsOperations.getConfiguration.mockReset().mockResolvedValue(CONTAINER_WEB_APP.siteConfig)
      webAppsOperations.listSiteContainers.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainer.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue({})
      webAppsOperations.listSiteExtensions.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.stop.mockReset().mockResolvedValue({})
      webAppsOperations.start.mockReset().mockResolvedValue({})
      webAppsOperations.restart.mockReset().mockResolvedValue({})
      webAppsOperations.getSlot.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.listSiteContainersSlot.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainerSlot.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettingsSlot.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettingsSlot.mockReset().mockResolvedValue({})
      webAppsOperations.listSiteExtensionsSlot.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.stopSlot.mockReset().mockResolvedValue({})
      webAppsOperations.startSlot.mockReset().mockResolvedValue({})
      webAppsOperations.restartSlot.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
      createAzureResource.mockClear().mockResolvedValue({})
      validateApiKey.mockClear().mockResolvedValue(true)
      handleSourceCodeIntegration
        .mockClear()
        .mockResolvedValue('git.commit.sha:test-sha,git.repository_url:test-remote')
    })

    test('Adds a sidecar and updates the application settings and tags', async () => {
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalled()
    })

    test('Performs no actions in dry run mode', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--dry-run'])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
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
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
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
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
      expect(getToken).not.toHaveBeenCalled()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Warns and exits if Web App is Windows but runtime cannot be detected', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue({...CONTAINER_WEB_APP, kind: 'app,windows'})
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Installs .NET extension on Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      const {code} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)

      // Verify API calls in correct order and with correct arguments
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.stop).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.stop).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(createAzureResource).toHaveBeenCalledTimes(1)
      expect(createAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.DotNet`,
        '2024-11-01',
        expect.any(Object)
      )
      expect(webAppsOperations.start).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.start).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        expect.objectContaining({
          properties: expect.objectContaining({
            DD_API_KEY: process.env.DD_API_KEY,
            DD_SITE: 'datadoghq.com',
            DD_SERVICE: 'my-web-app',
            DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          }),
        })
      )
      expect(updateTags).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledWith(
        WEB_APP_ID,
        expect.objectContaining({
          properties: expect.objectContaining({
            tags: expect.objectContaining({service: 'my-web-app'}),
          }),
        })
      )
    })

    test('Installs Node.js extension on Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_NODE_WEB_APP)
      const {code} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)

      // Verify API calls
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.stop).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.stop).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(createAzureResource).toHaveBeenCalledTimes(1)
      expect(createAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.Node.Apm`,
        '2024-11-01',
        expect.any(Object)
      )
      expect(webAppsOperations.start).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.start).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Installs Java extension on Windows app', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_JAVA_WEB_APP)
      const {code} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)

      // Verify API calls
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.stop).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.stop).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(createAzureResource).toHaveBeenCalledTimes(1)
      expect(createAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.Java.Apm`,
        '2024-11-01',
        expect.any(Object)
      )
      expect(webAppsOperations.start).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.start).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Uses manual Windows runtime override', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      const {code} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--windows-runtime', 'node'])
      expect(code).toEqual(0)

      // Verify Node extension is installed despite .NET runtime detected
      expect(createAzureResource).toHaveBeenCalledTimes(1)
      expect(createAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_ID}/siteextensions/Datadog.AzureAppServices.Node.Apm`,
        '2024-11-01',
        expect.any(Object)
      )
    })

    test('Skips extension installation if already present', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      webAppsOperations.listSiteExtensions
        .mockClear()
        .mockReturnValue(asyncIterable({name: 'my-web-app/Datadog.AzureAppServices.DotNet'}))
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toMatchSnapshot()
      expect(code).toEqual(0)

      // Verify extension installation was skipped
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.stop).not.toHaveBeenCalled()
      expect(createAzureResource).not.toHaveBeenCalled()
      expect(webAppsOperations.start).not.toHaveBeenCalled()

      // But env vars and tags still updated
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledTimes(1)
    })

    test('Dry run mode for Windows extension installation', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--dry-run'])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()

      // Verify read-only operations still happen
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledTimes(1)

      // Verify no write operations occurred
      expect(webAppsOperations.stop).not.toHaveBeenCalled()
      expect(createAzureResource).not.toHaveBeenCalled()
      expect(webAppsOperations.start).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Handles error during Windows extension installation', async () => {
      webAppsOperations.get.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      createAzureResource.mockClear().mockRejectedValue(new Error('extension installation failed'))
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()

      // Verify operations up to the error occurred
      expect(webAppsOperations.get).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.listSiteExtensions).toHaveBeenCalledTimes(1)
      expect(webAppsOperations.stop).toHaveBeenCalledTimes(1)
      expect(createAzureResource).toHaveBeenCalledTimes(1)

      // Start should not be called if extension installation fails
      expect(webAppsOperations.start).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar instrumentation', async () => {
      webAppsOperations.createOrUpdateSiteContainer.mockClear().mockRejectedValue(new Error('sidecar error'))
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
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

    test('Errors if no Web App is specified', async () => {
      const {code, context} = await runCLI([])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('Errors if the resource ID is invalid', async () => {
      const {code, context} = await runCLI(['-r', 'not-a-valid-resource-id'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
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
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('Errors if --slot is specified without -s/-g/-n', async () => {
      const {code, context} = await runCLI(['--slot', 'staging', '--no-source-code-integration'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain(
        '--slot can only specified if --subscription-id, --resource-group, and --name are specified'
      )
    })

    test('Errors if resource ID has invalid sub-resource type', async () => {
      const {code, context} = await runCLI([
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app/invalid/foo',
      ])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain('Invalid Web App (or Slot) resource ID')
    })

    test('Instruments multiple Web Apps in a single subscription', async () => {
      const {code, context} = await runCLI([
        '-r',
        WEB_APP_ID,
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.Web/sites/my-web-app2',
        '--no-source-code-integration',
      ])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
      expect(webAppsOperations.updateApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app2', {
        properties: {
          DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
          DD_SERVICE: 'my-web-app2',
          DD_API_KEY: 'PLACEHOLDER',
          DD_SITE: 'datadoghq.com',
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_ID + '2', {
        properties: {tags: {service: 'my-web-app2', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restart).toHaveBeenCalledTimes(2)
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.restart).toHaveBeenCalledWith('my-resource-group', 'my-web-app2')
    })

    test('Adds core tags to the Web App', async () => {
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
      expect(context.stdout.toString()).toMatchSnapshot()
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
      expect(context.stdout.toString()).toMatchSnapshot()
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
    })

    test('Validates extra tags format', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--extra-tags', 'invalid-tag-format'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('Validates windows runtime parameter', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--windows-runtime', 'invalid'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toMatchSnapshot()
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
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('Instruments a sidecar on a slot', async () => {
      webAppsOperations.getSlot.mockClear().mockResolvedValue(CONTAINER_WEB_APP)
      const {code, context} = await runCLI(SLOT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.getSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
      expect(webAppsOperations.listSiteContainersSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging'
      )
      expect(webAppsOperations.createOrUpdateSiteContainerSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging',
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
      expect(webAppsOperations.listApplicationSettingsSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging'
      )
      expect(webAppsOperations.updateApplicationSettingsSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging',
        {
          properties: {
            DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
            DD_SERVICE: 'my-web-app',
            DD_API_KEY: 'PLACEHOLDER',
            DD_SITE: 'datadoghq.com',
            WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
          },
        }
      )
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_SLOT_ID, {
        properties: {tags: {service: 'my-web-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(webAppsOperations.restartSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
    })

    test('Installs Windows extension on a slot', async () => {
      webAppsOperations.getSlot.mockClear().mockResolvedValue(WINDOWS_DOTNET_WEB_APP)
      const {code} = await runCLI(SLOT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)

      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.getSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
      expect(webAppsOperations.listSiteExtensionsSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging'
      )
      expect(webAppsOperations.stopSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
      expect(createAzureResource).toHaveBeenCalledWith(
        `${WEB_APP_SLOT_ID}/siteextensions/Datadog.AzureAppServices.DotNet`,
        '2024-11-01',
        expect.any(Object)
      )
      expect(webAppsOperations.startSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
      expect(webAppsOperations.updateApplicationSettingsSlot).toHaveBeenCalledTimes(1)
      expect(updateTags).toHaveBeenCalledWith(
        WEB_APP_SLOT_ID,
        expect.objectContaining({
          properties: expect.objectContaining({
            tags: expect.objectContaining({service: 'my-web-app'}),
          }),
        })
      )
    })

    test('Instruments a slot via resource ID', async () => {
      webAppsOperations.getSlot.mockClear().mockResolvedValue(CONTAINER_WEB_APP)
      const {code, context} = await runCLI(['-r', WEB_APP_SLOT_ID, '--no-source-code-integration'])
      expect(code).toEqual(0)
      expect(context.stdout.toString()).toMatchSnapshot()
      expect(webAppsOperations.get).not.toHaveBeenCalled()
      expect(webAppsOperations.getSlot).toHaveBeenCalledWith('my-resource-group', 'my-web-app', 'staging')
      expect(webAppsOperations.listSiteContainersSlot).toHaveBeenCalledWith(
        'my-resource-group',
        'my-web-app',
        'staging'
      )
      expect(updateTags).toHaveBeenCalledWith(WEB_APP_SLOT_ID, expect.any(Object))
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
      webAppsOperations.getSlot.mockReset().mockResolvedValue(CONTAINER_WEB_APP)
      webAppsOperations.listSiteContainersSlot.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainerSlot.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettingsSlot.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettingsSlot.mockReset().mockResolvedValue({})
      webAppsOperations.restartSlot.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('creates sidecar if not present and updates app settings', async () => {
      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', {name: 'app'}, false)

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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
    })

    test('adds .NET settings when the config option is specified', async () => {
      await command.instrumentSidecar(
        client,
        {...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, isDotnet: true},
        'rg',
        {name: 'app'},
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })
    })

    test('adds musl .NET settings when the config options are specified', async () => {
      await command.instrumentSidecar(
        client,
        {...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, isDotnet: true, isMusl: true},
        'rg',
        {name: 'app'},
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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
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

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', {name: 'app'}, false)

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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', {name: 'app'}, false)
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('does not call Azure APIs in dry run mode', async () => {
      command.dryRun = true
      webAppsOperations.listSiteContainers.mockReturnValue(asyncIterable())
      webAppsOperations.listApplicationSettings.mockResolvedValue({properties: {}})

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', {name: 'app'}, false)

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
          WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true',
        },
      })

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', {name: 'app'}, false)

      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
    })
  })
})
