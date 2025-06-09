jest.mock('fs')

jest.mock('../../../../package.json', () => ({version: 'XXXX'}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const webAppsOperations: any = {}

jest.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: jest.fn().mockImplementation(() => ({
    webApps: webAppsOperations,
  })),
}))

import * as fs from 'fs'

import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {InstrumentCommand} from '../instrument'

const mockNoConfigFile = () => {
  ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
}

describe('aas instrument', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['aas', 'instrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      mockNoConfigFile()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      webAppsOperations.getConfiguration = jest.fn().mockResolvedValue({kind: 'app,linux,container'})
      webAppsOperations.listSiteContainers = jest.fn().mockReturnValue(async function* () {})
      webAppsOperations.createOrUpdateSiteContainer = jest.fn().mockResolvedValue({})
      webAppsOperations.listApplicationSettings = jest.fn().mockResolvedValue({properties: {}})
      webAppsOperations.updateApplicationSettings = jest.fn().mockResolvedValue({})
    })

    test('Adds a sidecar and updates the application settings', async () => {
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
[Dry Run] 🐶 Instrumentation complete!
`)
      expect(code).toEqual(0)
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
    })
  })
})
