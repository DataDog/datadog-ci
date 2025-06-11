jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFile: jest.fn().mockImplementation((a, b, callback) => callback({code: 'ENOENT'})),
}))

jest.mock('../../../../package.json', () => ({version: 'XXXX'}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const webAppsOperations = {
  getConfiguration: jest.fn(),
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

import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {InstrumentCommand} from '../instrument'
import {AasConfigOptions} from '../interfaces'

async function* asyncIterable<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item
  }
}
const DEFAULT_CONFIG: AasConfigOptions = {
  subscriptionId: '00000000-0000-0000-0000-000000000000',
  resourceGroup: 'my-resource-group',
  aasName: 'my-web-app',
  service: undefined,
  environment: undefined,
  isInstanceLoggingEnabled: false,
  logPath: undefined,
}

describe('aas instrument', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['aas', 'instrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.getConfiguration.mockReset().mockResolvedValue({kind: 'app,linux,container'})
      webAppsOperations.listSiteContainers.mockReset().mockReturnValue(asyncIterable())
      webAppsOperations.createOrUpdateSiteContainer.mockReset().mockResolvedValue({})
      webAppsOperations.listApplicationSettings.mockReset().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings.mockReset().mockResolvedValue({})
      webAppsOperations.restart.mockReset().mockResolvedValue({})
    })

    test('Adds a sidecar and updates the application settings', async () => {
      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
      ])
      expect(context.stdout.toString()).toEqual(`🐶 Instrumenting Azure App Service
Creating sidecar container datadog-sidecar
Updating Application Settings
Restarting Azure App Service
🐶 Instrumentation complete!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
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
      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
        '--dry-run',
      ])
      expect(context.stdout.toString()).toEqual(`[Dry Run] 🐶 Instrumenting Azure App Service
[Dry Run] Creating sidecar container datadog-sidecar
[Dry Run] Updating Application Settings
[Dry Run] Restarting Azure App Service
[Dry Run] 🐶 Instrumentation complete!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Does not restart when specified', async () => {
      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
        '--no-restart',
      ])
      expect(context.stdout.toString()).toEqual(`🐶 Instrumenting Azure App Service
Creating sidecar container datadog-sidecar
Updating Application Settings
🐶 Instrumentation complete!
`)
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
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

      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
        '--dry-run',
      ])
      expect(context.stdout.toString()).toEqual(`[!] Failed to authenticate with Azure: Error

Please ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run az login to authenticate.

`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.getConfiguration).not.toHaveBeenCalled()
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Warns and exits if App Service is not Linux', async () => {
      webAppsOperations.getConfiguration.mockClear().mockResolvedValue({kind: 'app,windows'})
      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
      ])
      expect(context.stdout.toString()).toEqual(`🐶 Instrumenting Azure App Service
[!] Only Linux-based Azure App Services are currently supported.
Please see the documentation for information on
how to instrument Windows-based App Services:
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows
`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
      expect(webAppsOperations.listSiteContainers).not.toHaveBeenCalled()
      expect(webAppsOperations.createOrUpdateSiteContainer).not.toHaveBeenCalled()
      expect(webAppsOperations.listApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.updateApplicationSettings).not.toHaveBeenCalled()
      expect(webAppsOperations.restart).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar instrumentation', async () => {
      webAppsOperations.createOrUpdateSiteContainer.mockClear().mockRejectedValue(new Error('sidecar error'))
      const {code, context} = await runCLI([
        '-s',
        '00000000-0000-0000-0000-000000000000',
        '-g',
        'my-resource-group',
        '-n',
        'my-web-app',
      ])
      expect(context.stdout.toString()).toEqual(`🐶 Instrumenting Azure App Service
Creating sidecar container datadog-sidecar
[Error] Failed to instrument sidecar: Error: sidecar error
`)
      expect(code).toEqual(1)
      expect(webAppsOperations.getConfiguration).toHaveBeenCalledWith('my-resource-group', 'my-web-app')
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
  })
  describe('getEnvVars', () => {
    let command: InstrumentCommand
    let originalEnv: NodeJS.ProcessEnv
    beforeAll(() => {
      originalEnv = {...process.env}
    })

    beforeEach(() => {
      command = new InstrumentCommand()
      process.env.DD_API_KEY = 'test-api-key'
      delete process.env.DD_SITE
    })

    afterEach(() => {
      delete process.env.DD_API_KEY
      delete process.env.DD_SITE
    })

    afterAll(() => {
      process.env = originalEnv
    })

    test('returns required env vars with default DD_SITE', () => {
      const envVars = command.getEnvVars(DEFAULT_CONFIG)
      expect(envVars).toEqual({
        DD_API_KEY: 'test-api-key',
        DD_SITE: 'datadoghq.com',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'false',
      })
    })

    test('uses DD_SITE from environment if set', () => {
      process.env.DD_SITE = 'datadoghq.eu'
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: true,
      }
      const envVars = command.getEnvVars(config)
      expect(envVars.DD_SITE).toEqual('datadoghq.eu')
      expect(envVars.DD_AAS_INSTANCE_LOGGING_ENABLED).toEqual('true')
    })

    test('includes DD_SERVICE if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        service: 'my-service',
      }
      const envVars = command.getEnvVars(config)
      expect(envVars.DD_SERVICE).toEqual('my-service')
    })

    test('includes DD_ENV if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: false,
        environment: 'prod',
      }
      const envVars = command.getEnvVars(config)
      expect(envVars.DD_ENV).toEqual('prod')
    })

    test('includes DD_SERVERLESS_LOG_PATH if provided in config', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: false,
        logPath: '/tmp/logs',
      }
      const envVars = command.getEnvVars(config)
      expect(envVars.DD_SERVERLESS_LOG_PATH).toEqual('/tmp/logs')
    })

    test('includes all optional vars if provided', () => {
      const config: AasConfigOptions = {
        ...DEFAULT_CONFIG,
        isInstanceLoggingEnabled: true,
        service: 'svc',
        environment: 'dev',
        logPath: '/var/log',
      }
      const envVars = command.getEnvVars(config)
      expect(envVars).toMatchObject({
        DD_SERVICE: 'svc',
        DD_ENV: 'dev',
        DD_SERVERLESS_LOG_PATH: '/var/log',
        DD_AAS_INSTANCE_LOGGING_ENABLED: 'true',
      })
    })
  })
})
