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

const containerAppsOperations = {
  get: jest.fn(),
  beginUpdateAndWait: jest.fn(),
  listSecrets: jest.fn(),
}

const updateTags = jest.fn().mockResolvedValue({})

jest.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: jest.fn().mockImplementation(() => ({
    tagsOperations: {beginCreateOrUpdateAtScopeAndWait: updateTags},
  })),
}))

import {ContainerApp, ContainerAppsAPIClient} from '@azure/arm-appcontainers'
import {DefaultAzureCredential} from '@azure/identity'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {PluginCommand as InstrumentCommand} from '../commands/instrument'

import {
  CONTAINER_APP_ID,
  DEFAULT_CONFIG,
  DEFAULT_CONTAINER_APP,
  DEFAULT_INSTRUMENT_ARGS,
  NULL_SUBSCRIPTION_ID,
} from './common'

jest.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: jest.fn().mockImplementation(() => ({
    subscriptionId: NULL_SUBSCRIPTION_ID,
    containerApps: containerAppsOperations,
  })),
}))

const DEFAULT_CONFIG_WITH_DEFAULT_SERVICE = {
  ...DEFAULT_CONFIG,
  service: DEFAULT_CONFIG.containerAppName,
}

describe('container-app instrument', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['container-app', 'instrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(DEFAULT_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      containerAppsOperations.listSecrets.mockReset().mockResolvedValue({value: [{name: 'dd-api-key'}]})
      updateTags.mockClear().mockResolvedValue({})
      validateApiKey.mockClear().mockResolvedValue(true)
      handleSourceCodeIntegration
        .mockClear()
        .mockResolvedValue('git.commit.sha:test-sha,git.repository_url:test-remote')
    })

    test('Adds a sidecar and updates the tags', async () => {
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Updating tags for my-container-app')
      expect(output).toContain('🐶 Instrumentation completed successfully!')
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.listSecrets).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {service: 'my-container-app', dd_sls_ci: 'vXXXX'}},
      })
    })

    test('Performs no actions in dry run mode', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--dry-run'])
      const output = context.stdout.toString()
      expect(output).toContain('[Dry Run] 🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('[Dry Run] Updating configuration for my-container-app')
      expect(output).toContain('[Dry Run] Updating tags for my-container-app')
      expect(output).toContain('[Dry Run] 🐶 Instrumentation completed successfully!')
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.listSecrets).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Fails if not authenticated with Azure', async () => {
      getToken.mockClear().mockRejectedValue(new Error())

      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(context.stdout.toString()).toEqual(`[!] Failed to authenticate with Azure: Error

Please ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run az login to authenticate.

`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).not.toHaveBeenCalled()
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
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
      expect(containerAppsOperations.get).not.toHaveBeenCalled()
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Handles errors during sidecar instrumentation', async () => {
      containerAppsOperations.beginUpdateAndWait.mockClear().mockRejectedValue(new Error('sidecar error'))
      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('[Error] Failed to instrument my-container-app: Error: sidecar error')
      expect(output).toContain('🐶 Instrumentation completed with errors, see above for details.')
      expect(code).toEqual(1)
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.listSecrets).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalled()
      // tags should not be called due to the above failure
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Errors if no Azure Container App is specified', async () => {
      const {code, context} = await runCLI([])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual('[Error] No Container Apps specified to instrument\n')
    })

    test('Errors if the resource ID is invalid', async () => {
      const {code, context} = await runCLI(['-r', 'not-a-valid-resource-id'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual('[Error] Invalid Container App resource ID: not-a-valid-resource-id\n')
    })

    test('Errors include all resource IDs that are invalid', async () => {
      const {code, context} = await runCLI([
        '-r',
        'not-a-valid-resource-id',
        '-r',
        'another-invalid-id',
        '-r',
        CONTAINER_APP_ID,
      ])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toEqual(`[Error] Invalid Container App resource ID: not-a-valid-resource-id
[Error] Invalid Container App resource ID: another-invalid-id
`)
    })

    test('Instruments multiple Container Apps in a single subscription', async () => {
      containerAppsOperations.get.mockImplementation((rg: string, name: string) => {
        return Promise.resolve({...DEFAULT_CONTAINER_APP, name})
      })
      const {code, context} = await runCLI([
        '-r',
        CONTAINER_APP_ID,
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.App/containerApps/my-container-app2',
        '--no-source-code-integration',
      ])
      expect(code).toEqual(0)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Updating configuration for my-container-app2')
      expect(output).toContain('Updating tags for my-container-app')
      expect(output).toContain('Updating tags for my-container-app2')
      expect(output).toContain('🐶 Instrumentation completed successfully!')
      expect(getToken).toHaveBeenCalled()
      // Called 2 times to get each app
      expect(containerAppsOperations.get).toHaveBeenCalledTimes(2)
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app2')
      // Called 2 times to create/update sidecar
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledTimes(2)
      expect(updateTags).toHaveBeenCalledTimes(2)
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {service: 'my-container-app', dd_sls_ci: 'vXXXX'}},
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID + '2', {
        properties: {tags: {service: 'my-container-app2', dd_sls_ci: 'vXXXX'}},
      })
    })

    test('Adds core tags to the Azure Container App', async () => {
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
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Updating tags for my-container-app')
      expect(output).toContain('🐶 Instrumentation completed successfully!')
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: expect.arrayContaining([
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'DD_ENV', value: 'my-env'},
                {name: 'DD_VERSION', value: '1.0.0'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'DD_ENV', value: 'my-env'},
                {name: 'DD_VERSION', value: '1.0.0'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ]),
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {
          tags: {
            service: 'my-service',
            env: 'my-env',
            version: '1.0.0',
            dd_sls_ci: 'vXXXX',
          },
        },
      })
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
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning instrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Updating tags for my-container-app')
      expect(output).toContain('🐶 Instrumentation completed successfully!')
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {service: 'my-container-app', dd_sls_ci: 'vXXXX'}},
      })
    })

    test('Overrides default env vars with additional env vars', async () => {
      const {code} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--env-vars',
        'CUSTOM_VAR1=value1',
        '--env-vars',
        'DD_SITE=datad0g.com',
      ])
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datad0g.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datad0g.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {service: 'my-container-app', dd_sls_ci: 'vXXXX'}},
      })
    })

    test('Adds git metadata tags when source code integration is enabled', async () => {
      const {code} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--source-code-integration', '--upload-git-metadata'])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_TAGS', value: 'git.commit.sha:test-sha,git.repository_url:test-remote'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_TAGS', value: 'git.commit.sha:test-sha,git.repository_url:test-remote'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
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
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_TAGS', value: 'custom:tag,another:value'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_TAGS', value: 'custom:tag,another:value'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })

    test('Validates extra tags format', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--extra-tags', 'invalid-tag-format'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain('[Error] Extra tags do not comply with the <key>:<value> array.\n')
    })

    test('Validates sidecar CPU is a number', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--sidecar-cpu', 'invalid'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain('[Error] sidecarCpu must be a number\n')
    })

    test('Validates sidecar memory is a number', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--sidecar-memory', 'invalid'])
      expect(code).toEqual(1)
      expect(context.stdout.toString()).toContain('[Error] sidecarMemory must be a number\n')
    })
  })

  describe('instrumentSidecar', () => {
    let command: InstrumentCommand
    let client: ContainerAppsAPIClient

    beforeEach(() => {
      command = new InstrumentCommand()
      // no-dd-sa:typescript-best-practices/no-unsafe-assignment
      command.context = {stdout: {write: jest.fn()}} as any
      command.dryRun = false

      client = new ContainerAppsAPIClient(new DefaultAzureCredential(), NULL_SUBSCRIPTION_ID)

      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(DEFAULT_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('creates sidecar if not present', async () => {
      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', DEFAULT_CONTAINER_APP)

      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('rg', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })

    test('updates sidecar if present but config is incorrect', async () => {
      const containerAppWithSidecar = {
        ...DEFAULT_CONTAINER_APP,
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            ...DEFAULT_CONTAINER_APP.template!.containers!,
            {
              name: 'datadog-sidecar',
              image: 'wrong-image',
              env: [
                {name: 'DD_API_KEY', value: process.env.DD_API_KEY},
                {name: 'DD_SITE', value: 'datadoghq.com'},
              ],
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
            },
          ],
        },
      }

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', containerAppWithSidecar)

      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalled()
    })

    test('does not update sidecar if config is correct', async () => {
      const containerAppWithCorrectSidecar: ContainerApp = {
        ...DEFAULT_CONTAINER_APP,
        tags: {service: 'my-container-app'},
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: [
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: [
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ],
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [{name: 'shared-volume', storageType: 'EmptyDir'}],
        },
      }

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', containerAppWithCorrectSidecar)
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
    })

    test('leaves default variables alone on the main container', async () => {
      const containerAppWithCorrectSidecar: ContainerApp = {
        ...DEFAULT_CONTAINER_APP,
        tags: {service: 'my-container-app'},
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: [
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_LOGS_INJECTION', value: 'false'},
                {name: 'DD_TRACE_ENABLED', value: 'false'},
                {name: 'DD_HEALTH_PORT', value: '12345'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: [
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ],
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [{name: 'shared-volume', storageType: 'EmptyDir'}],
        },
      }

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', containerAppWithCorrectSidecar)
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
    })

    test('does not call Azure APIs in dry run mode', async () => {
      command.dryRun = true

      await command.instrumentSidecar(client, DEFAULT_CONFIG_WITH_DEFAULT_SERVICE, 'rg', DEFAULT_CONTAINER_APP)

      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
    })

    test('adds custom service name to sidecar env vars', async () => {
      const customConfig = {
        ...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE,
        service: 'custom-service-name',
      }

      await command.instrumentSidecar(client, customConfig, 'rg', DEFAULT_CONTAINER_APP)

      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('rg', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_SERVICE', value: 'custom-service-name'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_SERVICE', value: 'custom-service-name'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })

    test('adds custom environment variables to sidecar', async () => {
      const customConfig = {
        ...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE,
        envVars: ['CUSTOM_VAR1=value1', 'CUSTOM_VAR2=value2'],
      }

      await command.instrumentSidecar(client, customConfig, 'rg', DEFAULT_CONTAINER_APP)

      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('rg', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })

    test('adds env, version tags to sidecar when provided', async () => {
      const customConfig = {
        ...DEFAULT_CONFIG_WITH_DEFAULT_SERVICE,
        environment: 'production',
        version: '1.2.3',
      }

      await command.instrumentSidecar(client, customConfig, 'rg', DEFAULT_CONTAINER_APP)

      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('rg', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: process.env.DD_API_KEY,
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_ENV', value: 'production'},
                {name: 'DD_VERSION', value: '1.2.3'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_ENV', value: 'production'},
                {name: 'DD_VERSION', value: '1.2.3'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'rg'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })
  })

  describe('snapshot tests', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(DEFAULT_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      containerAppsOperations.listSecrets.mockReset().mockResolvedValue({value: []})
      updateTags.mockClear().mockResolvedValue({})
      validateApiKey.mockClear().mockResolvedValue(true)
      handleSourceCodeIntegration.mockClear().mockResolvedValue(undefined)
    })

    test('prints dry run data with basic flags', async () => {
      const {code, context} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--dry-run',
        '--service',
        'my-service',
        '--environment',
        'staging',
        '--version',
        '1.0.0',
        '--extra-tags',
        'team:backend,service:api',
        '--no-source-code-integration',
      ])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('prints configuration diff', async () => {
      const {code, context} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--no-source-code-integration'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(DEFAULT_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      containerAppsOperations.listSecrets.mockReset().mockResolvedValue({value: [{name: 'dd-api-key'}]})
      updateTags.mockClear().mockResolvedValue({})
      validateApiKey.mockClear().mockResolvedValue(true)
      handleSourceCodeIntegration
        .mockClear()
        .mockResolvedValue('git.commit.sha:test-sha,git.repository_url:test-remote')
    })

    test('Multiple subscriptions', async () => {
      containerAppsOperations.get.mockImplementation((rg: string, name: string) => {
        return Promise.resolve({...DEFAULT_CONTAINER_APP, name})
      })
      const {code, context} = await runCLI([
        '-r',
        '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg1/providers/Microsoft.App/containerApps/app1',
        '-r',
        '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/rg2/providers/Microsoft.App/containerApps/app2',
        '--no-source-code-integration',
      ])
      expect(code).toEqual(0)
      const output = context.stdout.toString()
      expect(output).toContain('Updating configuration for app1')
      expect(output).toContain('Updating configuration for app2')
      // Called 2 times to get each app
      expect(containerAppsOperations.get).toHaveBeenCalledTimes(2)
      expect(containerAppsOperations.get).toHaveBeenCalledWith('rg1', 'app1')
      expect(containerAppsOperations.get).toHaveBeenCalledWith('rg2', 'app2')
    })

    test('Tag update failure does not fail entire operation', async () => {
      updateTags.mockClear().mockRejectedValue(new Error('tag update error'))

      const {code, context} = await runCLI(DEFAULT_INSTRUMENT_ARGS)
      expect(code).toEqual(0)
      const output = context.stdout.toString()
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('[Error] Failed to update tags for my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalled()
      expect(updateTags).toHaveBeenCalled()
    })

    test('Uses custom sidecar name', async () => {
      const customSidecarName = 'custom-dd-sidecar'
      const {code} = await runCLI([...DEFAULT_INSTRUMENT_ARGS, '--sidecar-name', customSidecarName])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: customSidecarName,
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              probes: [
                {
                  failureThreshold: 3,
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  tcpSocket: {
                    port: 5555,
                  },
                  timeoutSeconds: 1,
                  type: 'Startup',
                },
              ],
              resources: {
                cpu: 0.5,
                memory: '1Gi',
              },
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {service: 'my-container-app', dd_sls_ci: 'vXXXX'}},
      })
    })

    test('Environment variables are properly merged', async () => {
      const {code} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--service',
        'my-service',
        '--environment',
        'staging',
        '--env-vars',
        'CUSTOM_VAR=custom_value',
      ])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'DD_ENV', value: 'staging'},
                {name: 'CUSTOM_VAR', value: 'custom_value'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'DD_ENV', value: 'staging'},
                {name: 'CUSTOM_VAR', value: 'custom_value'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {cpu: 0.5, memory: '1Gi'},
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })

    test('Uses custom sidecar CPU and memory', async () => {
      const {code} = await runCLI([
        ...DEFAULT_INSTRUMENT_ARGS,
        '--sidecar-cpu',
        '0.25',
        '--sidecar-memory',
        '0.5',
      ])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [
            {
              name: 'dd-api-key',
              value: 'PLACEHOLDER',
            },
          ],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: expect.arrayContaining([
                ...DEFAULT_CONTAINER_APP.template!.containers![0].env!,
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: expect.arrayContaining([
                {name: 'DD_LOGS_INJECTION', value: 'true'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'DD_HEALTH_PORT', value: '5555'},
                {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
                {name: 'DD_SITE', value: 'datadoghq.com'},
                {name: 'DD_SERVICE', value: 'my-container-app'},
                {name: 'DD_AZURE_SUBSCRIPTION_ID', value: '00000000-0000-0000-0000-000000000000'},
                {name: 'DD_AZURE_RESOURCE_GROUP', value: 'my-resource-group'},
                {name: 'DD_SERVERLESS_LOG_PATH', value: '/shared-volume/logs/*.log'},
              ]),
              resources: {cpu: 0.25, memory: '0.5Gi'},
              probes: [
                {
                  type: 'Startup',
                  tcpSocket: {
                    port: 5555,
                  },
                  initialDelaySeconds: 0,
                  periodSeconds: 10,
                  failureThreshold: 3,
                  timeoutSeconds: 1,
                },
              ],
              volumeMounts: [{volumeName: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [
            {
              name: 'shared-volume',
              storageType: 'EmptyDir',
            },
          ],
        },
      })
    })
  })
})
