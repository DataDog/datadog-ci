jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const getToken = jest.fn()

jest.mock('@azure/identity', () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({
    getToken,
  })),
}))

const containerAppsOperations = {
  get: jest.fn(),
  beginUpdateAndWait: jest.fn(),
}

const updateTags = jest.fn().mockResolvedValue({})

jest.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: jest.fn().mockImplementation(() => ({
    tagsOperations: {beginCreateOrUpdateAtScopeAndWait: updateTags},
  })),
}))

import {ContainerApp, Container} from '@azure/arm-appcontainers'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {DEFAULT_SIDECAR_NAME, DEFAULT_VOLUME_NAME} from '@datadog/datadog-ci-base/helpers/serverless/constants'

import {PluginCommand as UninstrumentCommand} from '../commands/uninstrument'

import {CONTAINER_APP_ID, DEFAULT_ARGS, DEFAULT_CONFIG, DEFAULT_CONTAINER_APP, NULL_SUBSCRIPTION_ID} from './common'

jest.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: jest.fn().mockImplementation(() => ({
    subscriptionId: NULL_SUBSCRIPTION_ID,
    containerApps: containerAppsOperations,
  })),
}))

const INSTRUMENTED_CONTAINER_APP: ContainerApp = {
  ...DEFAULT_CONTAINER_APP,
  tags: {service: 'my-service', env: 'staging', version: '1.0.0', dd_sls_ci: 'vXXXX'},
  configuration: {
    secrets: [
      {name: 'dd-api-key', value: 'PLACEHOLDER'},
      {name: 'other-secret', value: 'OTHER'},
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
          {name: 'DD_SERVICE', value: 'my-service'},
          {name: 'DD_ENV', value: 'staging'},
          {name: 'DD_VERSION', value: '1.0.0'},
        ],
        volumeMounts: [{volumeName: DEFAULT_VOLUME_NAME, mountPath: '/shared-volume'}],
      },
      {
        name: DEFAULT_SIDECAR_NAME,
        image: 'index.docker.io/datadog/serverless-init:latest',
        env: [
          {name: 'DD_API_KEY', secretRef: 'dd-api-key'},
          {name: 'DD_SITE', value: 'datadoghq.com'},
        ],
        resources: {cpu: 0.25, memory: '0.5Gi'},
        volumeMounts: [{volumeName: DEFAULT_VOLUME_NAME, mountPath: '/shared-volume'}],
      },
    ],
    volumes: [{name: DEFAULT_VOLUME_NAME, storageType: 'EmptyDir'}],
  },
}

describe('container-app uninstrument', () => {
  const runCLI = makeRunCLI(UninstrumentCommand, ['container-app', 'uninstrument'])

  describe('execute', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(INSTRUMENTED_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('Removes sidecar, volume, DD env vars, secret, and tags', async () => {
      const {code, context} = await runCLI(DEFAULT_ARGS)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning uninstrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Removing tags from my-container-app')
      expect(output).toContain('🐶 Uninstrumentation completed successfully!')
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...INSTRUMENTED_CONTAINER_APP,
        configuration: {
          secrets: [{name: 'other-secret', value: 'OTHER'}],
        },
        template: {
          ...INSTRUMENTED_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: DEFAULT_CONTAINER_APP.template!.containers![0].env,
              volumeMounts: [],
            },
          ],
          volumes: [],
        },
      })
      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {}},
      })
    })

    test('Performs no actions in dry run mode', async () => {
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])
      const output = context.stdout.toString()
      expect(output).toContain('[Dry Run] 🐶 Beginning uninstrumentation of Azure Container App(s)')
      expect(output).toContain('[Dry Run] Updating configuration for my-container-app')
      expect(output).toContain('[Dry Run] Removing tags from my-container-app')
      expect(output).toContain('[Dry Run] 🐶 Uninstrumentation completed successfully!')
      expect(code).toEqual(0)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
      expect(updateTags).not.toHaveBeenCalled()
    })

    test('Fails if not authenticated with Azure', async () => {
      getToken.mockClear().mockRejectedValue(new Error())

      const {code, context} = await runCLI(DEFAULT_ARGS)
      expect(context.stdout.toString()).toEqual(`[!] Failed to authenticate with Azure: Error

Please ensure that you have the Azure CLI installed (https://aka.ms/azure-cli) and have run az login to authenticate.

`)
      expect(code).toEqual(1)
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).not.toHaveBeenCalled()
      expect(containerAppsOperations.beginUpdateAndWait).not.toHaveBeenCalled()
    })

    test('Handles errors during uninstrumentation', async () => {
      containerAppsOperations.beginUpdateAndWait.mockClear().mockRejectedValue(new Error('uninstrument error'))
      const {code, context} = await runCLI(DEFAULT_ARGS)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning uninstrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('[Error] Failed to uninstrument my-container-app: Error: uninstrument error')
      expect(output).toContain('🐶 Uninstrumentation completed with errors, see above for details.')
      expect(code).toEqual(1)
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
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

    test('Uninstruments multiple Container Apps in a single subscription', async () => {
      containerAppsOperations.get.mockImplementation((rg: string, name: string) => {
        return Promise.resolve({...INSTRUMENTED_CONTAINER_APP, name})
      })
      const {code, context} = await runCLI([
        '-r',
        CONTAINER_APP_ID,
        '-r',
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-resource-group/providers/Microsoft.App/containerApps/my-container-app2',
      ])
      expect(code).toEqual(0)
      const output = context.stdout.toString()
      expect(output).toContain('🐶 Beginning uninstrumentation of Azure Container App(s)')
      expect(output).toContain('Updating configuration for my-container-app')
      expect(output).toContain('Updating configuration for my-container-app2')
      expect(output).toContain('Removing tags from my-container-app')
      expect(output).toContain('Removing tags from my-container-app2')
      expect(output).toContain('🐶 Uninstrumentation completed successfully!')
      expect(getToken).toHaveBeenCalled()
      expect(containerAppsOperations.get).toHaveBeenCalledTimes(2)
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app')
      expect(containerAppsOperations.get).toHaveBeenCalledWith('my-resource-group', 'my-container-app2')
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledTimes(2)
      expect(updateTags).toHaveBeenCalledTimes(2)
    })

    test('Uses custom sidecar and volume names', async () => {
      const customSidecarName = 'custom-sidecar'
      const customVolumeName = 'custom-volume'
      const customInstrumentedApp: ContainerApp = {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [{name: 'dd-api-key', value: 'PLACEHOLDER'}],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: [...DEFAULT_CONTAINER_APP.template!.containers![0].env!, {name: 'DD_SERVICE', value: 'my-service'}],
              volumeMounts: [{volumeName: customVolumeName, mountPath: '/custom'}],
            },
            {
              name: customSidecarName,
              image: 'index.docker.io/datadog/serverless-init:latest',
              env: [{name: 'DD_API_KEY', secretRef: 'dd-api-key'}],
              resources: {cpu: 0.25, memory: '0.5Gi'},
              volumeMounts: [{volumeName: customVolumeName, mountPath: '/custom'}],
            },
          ],
          volumes: [{name: customVolumeName, storageType: 'EmptyDir'}],
        },
      }
      containerAppsOperations.get.mockReset().mockResolvedValue(customInstrumentedApp)

      const {code} = await runCLI([
        ...DEFAULT_ARGS,
        '--sidecar-name',
        customSidecarName,
        '--shared-volume-name',
        customVolumeName,
      ])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...customInstrumentedApp,
        configuration: {
          secrets: [],
        },
        template: {
          ...customInstrumentedApp.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: DEFAULT_CONTAINER_APP.template!.containers![0].env,
              volumeMounts: [],
            },
          ],
          volumes: [],
        },
      })
    })

    test('Removes custom env vars provided via --env-vars', async () => {
      const appWithCustomEnvVars: ContainerApp = {
        ...INSTRUMENTED_CONTAINER_APP,
        template: {
          ...INSTRUMENTED_CONTAINER_APP.template,
          containers: [
            {
              ...INSTRUMENTED_CONTAINER_APP.template!.containers![0],
              env: [
                {name: 'PORT', value: '8080'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'PRESERVE_ME', value: 'keep'},
              ],
            },
            INSTRUMENTED_CONTAINER_APP.template!.containers![1],
          ],
        },
      }
      containerAppsOperations.get.mockReset().mockResolvedValue(appWithCustomEnvVars)

      const {code} = await runCLI([
        ...DEFAULT_ARGS,
        '--env-vars',
        'CUSTOM_VAR1=value1',
        '--env-vars',
        'CUSTOM_VAR2=value2',
      ])
      expect(code).toEqual(0)
      expect(containerAppsOperations.beginUpdateAndWait).toHaveBeenCalledWith('my-resource-group', 'my-container-app', {
        ...appWithCustomEnvVars,
        configuration: {
          secrets: [{name: 'other-secret', value: 'OTHER'}],
        },
        template: {
          ...appWithCustomEnvVars.template,
          containers: [
            {
              ...appWithCustomEnvVars.template!.containers![0],
              env: [
                {name: 'PORT', value: '8080'},
                {name: 'PRESERVE_ME', value: 'keep'},
              ],
              volumeMounts: [],
            },
          ],
          volumes: [],
        },
      })
    })
  })

  describe('snapshot tests', () => {
    beforeEach(() => {
      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(INSTRUMENTED_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('prints dry run data', async () => {
      const {code, context} = await runCLI([...DEFAULT_ARGS, '--dry-run'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('prints configuration diff', async () => {
      const {code, context} = await runCLI(DEFAULT_ARGS)

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })
  })

  describe('createUninstrumentedAppConfig', () => {
    let command: UninstrumentCommand

    beforeEach(() => {
      command = new UninstrumentCommand()
      // no-dd-sa:typescript-best-practices/no-unsafe-assignment
      command.context = {stdout: {write: jest.fn()}} as any
      command.dryRun = false

      jest.resetModules()
      getToken.mockClear().mockResolvedValue({token: 'token'})
      containerAppsOperations.get.mockReset().mockResolvedValue(DEFAULT_CONTAINER_APP)
      containerAppsOperations.beginUpdateAndWait.mockReset().mockResolvedValue({})
      updateTags.mockClear().mockResolvedValue({})
    })

    test('removes sidecar container, shared volume, DD_* env vars, and secret', () => {
      const config = {...DEFAULT_CONFIG, sidecarName: DEFAULT_SIDECAR_NAME, sharedVolumeName: DEFAULT_VOLUME_NAME}
      const result = command.createUninstrumentedAppConfig(config, INSTRUMENTED_CONTAINER_APP)

      // Should remove sidecar container
      expect(result.template?.containers).toHaveLength(1)
      expect(result.template?.containers?.map((c: Container) => c.name)).toEqual(['main-container'])

      // Should remove shared volume
      expect(result.template?.volumes).toHaveLength(0)

      // Should remove DD_* env vars and shared volume mount from main container
      const main = result.template?.containers?.find((c: Container) => c.name === 'main-container')
      expect(main?.volumeMounts).toHaveLength(0)
      expect(main?.env).toEqual([{name: 'PORT', value: '8080'}])

      // Should remove dd-api-key secret
      expect(result.configuration?.secrets).toEqual([{name: 'other-secret', value: 'OTHER'}])
    })

    test('handles app with no sidecar or shared volume gracefully', () => {
      const config = {...DEFAULT_CONFIG, sidecarName: DEFAULT_SIDECAR_NAME, sharedVolumeName: DEFAULT_VOLUME_NAME}
      const result = command.createUninstrumentedAppConfig(config, DEFAULT_CONTAINER_APP)

      expect(result.template?.containers).toHaveLength(1)
      expect(result.template?.volumes).toEqual([])
    })

    test('preserves non-DD env vars', () => {
      const appWithMixedEnvVars: ContainerApp = {
        ...DEFAULT_CONTAINER_APP,
        configuration: {
          secrets: [{name: 'dd-api-key', value: 'PLACEHOLDER'}],
        },
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: [
                {name: 'PORT', value: '8080'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'CUSTOM_VAR', value: 'keep-me'},
                {name: 'DD_TRACE_ENABLED', value: 'true'},
                {name: 'NODE_ENV', value: 'production'},
              ],
            },
          ],
        },
      }

      const config = {...DEFAULT_CONFIG, sidecarName: DEFAULT_SIDECAR_NAME, sharedVolumeName: DEFAULT_VOLUME_NAME}
      const result = command.createUninstrumentedAppConfig(config, appWithMixedEnvVars)

      const main = result.template?.containers?.find((c: Container) => c.name === 'main-container')
      expect(main?.env).toEqual([
        {name: 'PORT', value: '8080'},
        {name: 'CUSTOM_VAR', value: 'keep-me'},
        {name: 'NODE_ENV', value: 'production'},
      ])
    })

    test('preserves non-dd-api-key secrets', () => {
      const config = {...DEFAULT_CONFIG, sidecarName: DEFAULT_SIDECAR_NAME, sharedVolumeName: DEFAULT_VOLUME_NAME}
      const result = command.createUninstrumentedAppConfig(config, INSTRUMENTED_CONTAINER_APP)

      expect(result.configuration?.secrets).toEqual([{name: 'other-secret', value: 'OTHER'}])
    })

    test('removes custom env vars from config.envVars', () => {
      const appWithCustomEnvVars: ContainerApp = {
        ...DEFAULT_CONTAINER_APP,
        template: {
          ...DEFAULT_CONTAINER_APP.template,
          containers: [
            {
              ...DEFAULT_CONTAINER_APP.template!.containers![0],
              env: [
                {name: 'PORT', value: '8080'},
                {name: 'DD_SERVICE', value: 'my-service'},
                {name: 'CUSTOM_VAR1', value: 'value1'},
                {name: 'CUSTOM_VAR2', value: 'value2'},
                {name: 'PRESERVE_ME', value: 'keep'},
              ],
            },
          ],
        },
      }

      const config = {
        ...DEFAULT_CONFIG,
        sidecarName: DEFAULT_SIDECAR_NAME,
        sharedVolumeName: DEFAULT_VOLUME_NAME,
        envVars: ['CUSTOM_VAR1=value1', 'CUSTOM_VAR2=value2'],
      }
      const result = command.createUninstrumentedAppConfig(config, appWithCustomEnvVars)

      const main = result.template?.containers?.find((c: Container) => c.name === 'main-container')
      expect(main?.env).toEqual([
        {name: 'PORT', value: '8080'},
        {name: 'PRESERVE_ME', value: 'keep'},
      ])
    })
  })

  describe('removeTags', () => {
    let command: UninstrumentCommand

    beforeEach(() => {
      command = new UninstrumentCommand()
      // no-dd-sa:typescript-best-practices/no-unsafe-assignment
      command.context = {stdout: {write: jest.fn()}} as any
      command.dryRun = false
      // Initialize tagClient
      // no-dd-sa:typescript-best-practices/no-unsafe-assignment
      ;(command as any).tagClient = {beginCreateOrUpdateAtScopeAndWait: updateTags}
      updateTags.mockClear().mockResolvedValue({})
    })

    test('removes service, env, version, and dd_sls_ci tags', async () => {
      await command.removeTags(NULL_SUBSCRIPTION_ID, 'my-resource-group', INSTRUMENTED_CONTAINER_APP)

      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {tags: {}},
      })
    })

    test('does not call Azure API in dry-run mode', async () => {
      command.dryRun = true
      await command.removeTags(NULL_SUBSCRIPTION_ID, 'my-resource-group', INSTRUMENTED_CONTAINER_APP)

      expect(updateTags).not.toHaveBeenCalled()
    })

    test('preserves non-DD tags', async () => {
      const appWithExtraTags: ContainerApp = {
        ...INSTRUMENTED_CONTAINER_APP,
        tags: {
          ...INSTRUMENTED_CONTAINER_APP.tags,
          team: 'backend',
          cost_center: '12345',
        },
      }

      await command.removeTags(NULL_SUBSCRIPTION_ID, 'my-resource-group', appWithExtraTags)

      expect(updateTags).toHaveBeenCalledWith(CONTAINER_APP_ID, {
        properties: {
          tags: {
            team: 'backend',
            cost_center: '12345',
          },
        },
      })
    })
  })
})
