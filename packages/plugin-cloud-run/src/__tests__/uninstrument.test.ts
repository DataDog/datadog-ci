import type {IContainer, IService} from '../types'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {
  API_KEY_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {TRACER_CONTAINER_NAME, TRACER_VOLUME_NAME} from '@datadog/datadog-ci-base/helpers/serverless/ssi/constants'
import {SINGLE_LANGUAGE_INJECTION_MODE_TAG} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'

import {PluginCommand as UninstrumentCommand} from '../commands/uninstrument'
import * as cloudRunPromptModule from '../prompt'
import {uninstrumentServiceConfig} from '../service-config'
import * as utils from '../utils'

const SSI_INJECTION_MODE_LABEL = 'dd_sls_injection_mode'
const SINGLE_LANGUAGE_SSI_MODE = 'single_language'

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  checkAuthentication: jest.fn(),
}))

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: 'XXXX'}))

const mockServicesClient = {
  servicePath: jest.fn(),
  getService: jest.fn(),
  updateService: jest.fn(),
}

jest.mock('@google-cloud/run', () => ({
  ServicesClient: jest.fn(() => mockServicesClient),
}))

describe('UninstrumentCommand', () => {
  const runCLI = makeRunCLI(UninstrumentCommand, ['cloud-run', 'uninstrument'])

  beforeEach(() => {
    jest.clearAllMocks()
    ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(true)
    mockServicesClient.servicePath.mockImplementation(
      (project: string, region: string, service: string) =>
        `projects/${project}/locations/${region}/services/${service}`
    )
  })

  describe('validates required variables', () => {
    test('should fail if required flags are missing', async () => {
      const cases = [
        {args: ['--services', 'test-service', '--region', 'us-central1'], expected: 'missing project'},
        {args: ['--project', 'test-project', '--region', 'us-central1'], expected: 'missing service(s)'},
        {args: ['--project', 'test-project', '--services', 'test-service'], expected: 'missing region'},
      ]

      for (const {args, expected} of cases) {
        const {code, context} = await runCLI(args)
        expect(code).toBe(1)
        expect(context.stdout.toString()).toContain(expected)
      }
    })
  })

  describe('main uninstrument command flow', () => {
    test('should fail if GCP credentials are invalid', async () => {
      ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(false)
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Unable to authenticate with GCP')
    })

    test('should succeed with valid parameters', async () => {
      const mockUninstrumentSidecar = jest.fn().mockResolvedValue(undefined)
      jest
        .spyOn(UninstrumentCommand.prototype as any, 'uninstrumentSidecar')
        .mockImplementation(mockUninstrumentSidecar)

      const {code} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(0)
      expect(mockUninstrumentSidecar).toHaveBeenCalledWith('test-project', ['test-service'], 'us-central1')
    })
  })

  describe('snapshot tests', () => {
    const mockService: IService = {
      name: 'projects/test-project/locations/us-central1/services/test-service',
      labels: {service: 'test-service'},
      template: {
        containers: [
          {
            name: 'main-app',
            image: 'gcr.io/test-project/test-app:latest',
            env: [
              {name: 'NODE_ENV', value: 'production'},
              {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
              {name: SERVICE_ENV_VAR, value: 'test-service'},
            ],
            volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
          },
          {
            name: 'datadog-sidecar',
            image: 'gcr.io/datadoghq/serverless-init:latest',
            env: [{name: API_KEY_ENV_VAR, value: 'test-api-key'}],
            volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
          },
        ],
        volumes: [{name: 'shared-volume', emptyDir: {}}],
        revision: 'test-service-v1',
      },
    }

    beforeEach(() => {
      mockServicesClient.getService.mockResolvedValue([mockService])
      mockServicesClient.updateService.mockResolvedValue([{promise: jest.fn().mockResolvedValue([])}])
      jest.restoreAllMocks()
      ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(true)
    })

    test('prints dry run data', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
        '--dry-run',
      ])
      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('interactive mode', async () => {
      jest.spyOn(cloudRunPromptModule, 'requestGCPProject').mockResolvedValue('interactive-project')
      jest.spyOn(cloudRunPromptModule, 'requestGCPRegion').mockResolvedValue('us-west1')
      jest.spyOn(cloudRunPromptModule, 'requestServiceName').mockResolvedValue('interactive-service')
      jest.spyOn(cloudRunPromptModule, 'requestConfirmation').mockResolvedValue(true)

      const {code, context} = await runCLI(['--interactive'])
      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })
  })

  describe('createUninstrumentedServiceConfig', () => {
    let command: UninstrumentCommand
    let writeStdout: jest.Mock

    beforeEach(() => {
      command = new UninstrumentCommand()
      writeStdout = jest.fn()
      ;(command as any).sidecarName = 'datadog-sidecar'
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).envVars = []
      ;(command as any).context = {
        stdout: {write: writeStdout},
        stderr: {write: jest.fn()},
      }
    })

    test('removes sidecar container, shared volume, and DD_ env vars', () => {
      const service: IService = {
        labels: {service: 'test-service', env: 'staging', version: '1.0.0'},
        template: {
          containers: [
            {
              name: 'main',
              env: [
                {name: 'NODE_ENV', value: 'production'},
                {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
                {name: SERVICE_ENV_VAR, value: 'test-service'},
                {name: ENVIRONMENT_ENV_VAR, value: 'staging'},
                {name: VERSION_ENV_VAR, value: '1.0.0'},
                {name: DD_TAGS_ENV_VAR, value: 'team:backend'},
                {name: 'CUSTOM_VAR', value: 'keep-me'},
              ],
              volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
            },
            {
              name: 'datadog-sidecar',
              env: [{name: API_KEY_ENV_VAR, value: 'test-key'}],
              volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
            },
          ],
          volumes: [{name: 'shared-volume', emptyDir: {}}],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)

      // Should remove sidecar container
      expect(result.template?.containers).toHaveLength(1)
      expect(result.template?.containers?.map((c: IContainer) => c.name)).toEqual(['main'])

      // Should remove shared volume
      expect(result.template?.volumes).toHaveLength(0)

      // Should remove DD_ env vars and shared volume mount from main container
      const main = result.template?.containers?.find((c: IContainer) => c.name === 'main')
      expect(main?.volumeMounts).toHaveLength(0)
      expect(main?.env).toEqual([
        {name: 'NODE_ENV', value: 'production'},
        {name: 'CUSTOM_VAR', value: 'keep-me'},
      ])
    })

    test('removes owned SSI state from a named main container', () => {
      ;(command as any).envVars = ['CONFIGURED_VAR=remove-me']
      const service: IService = {
        labels: {[SSI_INJECTION_MODE_LABEL]: SINGLE_LANGUAGE_SSI_MODE, customer: 'keep-me'},
        launchStage: 'BETA',
        template: {
          executionEnvironment: 2,
          containers: [
            {
              name: 'app',
              env: [
                {
                  name: 'NODE_OPTIONS',
                  value: '--inspect --require /datadog-lib/node_modules/dd-trace/init.js',
                },
                {name: DD_TAGS_ENV_VAR, value: `${SINGLE_LANGUAGE_INJECTION_MODE_TAG},team:backend`},
                {name: 'DD_CUSTOM', value: 'remove-me'},
                {name: 'CONFIGURED_VAR', value: 'remove-me'},
                {name: 'CUSTOM_VAR', value: 'keep-me'},
              ],
              volumeMounts: [
                {name: 'shared-volume', mountPath: '/shared-volume'},
                {name: TRACER_VOLUME_NAME, mountPath: '/datadog-lib'},
                {name: 'customer-volume', mountPath: '/customer'},
              ],
              dependsOn: ['datadog-sidecar', TRACER_CONTAINER_NAME, 'database'],
            },
            {name: 'datadog-sidecar'},
            {name: TRACER_CONTAINER_NAME},
          ],
          volumes: [
            {name: 'shared-volume', emptyDir: {}},
            {name: TRACER_VOLUME_NAME, emptyDir: {}},
            {name: 'customer-volume', emptyDir: {}},
          ],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)

      expect(result.labels).toEqual({customer: 'keep-me'})
      expect(result.launchStage).toBe('BETA')
      expect(result.template?.executionEnvironment).toBe(2)
      expect(result.template?.containers).toEqual([
        expect.objectContaining({
          name: 'app',
          env: [
            {name: 'NODE_OPTIONS', value: '--inspect'},
            {name: 'CUSTOM_VAR', value: 'keep-me'},
          ],
          volumeMounts: [{name: 'customer-volume', mountPath: '/customer'}],
          dependsOn: ['database'],
        }),
      ])
      expect(result.template?.volumes).toEqual([{name: 'customer-volume', emptyDir: {}}])
    })

    test('removes recognizable multi-language state without an injection label', () => {
      const preload = '/opt/datadog-packages/datadog-apm-inject/stable/inject/launcher.preload.so'
      const service: IService = {
        labels: {customer: 'keep-me'},
        template: {
          containers: [
            {
              name: 'app',
              env: [
                {name: 'LD_PRELOAD', value: `${preload} /customer/preload.so`},
                {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless'},
                {name: 'CUSTOM_VAR', value: 'keep-me'},
              ],
              volumeMounts: [{name: TRACER_VOLUME_NAME, mountPath: '/opt/datadog-packages'}],
              dependsOn: [TRACER_CONTAINER_NAME, 'database'],
            },
            {name: TRACER_CONTAINER_NAME},
          ],
          volumes: [{name: TRACER_VOLUME_NAME, emptyDir: {}}],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)

      expect(result.labels).toEqual({customer: 'keep-me'})
      expect(result.template?.containers).toEqual([
        expect.objectContaining({
          name: 'app',
          env: [
            {name: 'LD_PRELOAD', value: '/customer/preload.so'},
            {name: 'CUSTOM_VAR', value: 'keep-me'},
          ],
          volumeMounts: [],
          dependsOn: ['database'],
        }),
      ])
      expect(result.template?.volumes).toEqual([])
    })

    test('keeps an unnamed main container unnamed', () => {
      const service: IService = {
        labels: {
          [SSI_INJECTION_MODE_LABEL]: SINGLE_LANGUAGE_SSI_MODE,
          customer: 'keep-me',
        },
        template: {
          containers: [
            {
              name: '',
              volumeMounts: [{name: TRACER_VOLUME_NAME, mountPath: '/datadog-lib'}],
            },
          ],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)

      expect(result.labels).toEqual({customer: 'keep-me'})
      expect(result.template?.containers?.[0].name).toBe('')
    })

    test('handles service with no sidecar or shared volume gracefully', () => {
      const service = {
        template: {
          containers: [{name: 'main', env: [{name: 'NODE_ENV', value: 'production'}], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)
      expect(result.template?.containers).toHaveLength(1)
      expect(result.template?.volumes).toHaveLength(0)
      expect(writeStdout).toHaveBeenCalledWith(expect.stringContaining("Sidecar container 'datadog-sidecar' not found"))
      expect(writeStdout).toHaveBeenCalledWith(expect.stringContaining("Shared volume 'shared-volume' not found"))
    })

    test.each([[], undefined])('handles %p configured environment variables', (envVars) => {
      ;(command as any).envVars = envVars
      const service = {
        template: {
          containers: [
            {
              name: 'main',
              env: [
                {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
                {name: 'CUSTOM_VAR', value: 'custom-value'},
              ],
            },
          ],
        },
      }

      expect(command.createUninstrumentedServiceConfig(service).template?.containers?.[0].env).toEqual([
        {name: 'CUSTOM_VAR', value: 'custom-value'},
      ])
    })

    test('uses custom sidecar and volume names', () => {
      ;(command as any).sidecarName = 'custom-sidecar'
      ;(command as any).sharedVolumeName = 'custom-volume'

      const service = {
        template: {
          containers: [
            {name: 'main', env: [], volumeMounts: [{name: 'custom-volume', mountPath: '/custom/path'}]},
            {name: 'custom-sidecar', env: [], volumeMounts: []},
          ],
          volumes: [{name: 'custom-volume', emptyDir: {}}],
        },
      }

      const result = command.createUninstrumentedServiceConfig(service)
      expect(result.template?.containers).toHaveLength(1)
      expect(result.template?.containers?.map((c: IContainer) => c.name)).toEqual(['main'])
      expect(result.template?.volumes).toHaveLength(0)
    })
  })

  describe('application container cleanup', () => {
    let envVarNames: ReadonlySet<string>

    beforeEach(() => {
      envVarNames = new Set()
    })

    const cleanAppContainer = (appContainer: IContainer): IContainer =>
      uninstrumentServiceConfig(
        {template: {containers: [appContainer]}},
        {sidecarName: 'datadog-sidecar', sharedVolumeName: 'shared-volume', envVarNames}
      ).service.template!.containers![0]

    test('removes shared volume mount and DD_ environment variables', () => {
      const appContainer = {
        name: 'main',
        env: [
          {name: 'NODE_ENV', value: 'production'},
          {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
          {name: DD_TAGS_ENV_VAR, value: 'team:backend'},
          {name: 'CUSTOM_VAR', value: 'keep-me'},
        ],
        volumeMounts: [
          {name: 'shared-volume', mountPath: '/shared-volume'},
          {name: 'other-volume', mountPath: '/other'},
        ],
      }

      const result = cleanAppContainer(appContainer)

      expect(result.volumeMounts).toEqual([{name: 'other-volume', mountPath: '/other'}])
      expect(result.env).toEqual([
        {name: 'NODE_ENV', value: 'production'},
        {name: 'CUSTOM_VAR', value: 'keep-me'},
      ])
    })

    test('handles container with undefined env and volumeMounts', () => {
      const result = cleanAppContainer({name: 'main'})

      expect(result.volumeMounts).toEqual([])
      expect(result.env).toEqual([])
    })

    test('removes dependencies on the Agent container without an SSI label', () => {
      expect(cleanAppContainer({name: 'main', dependsOn: ['datadog-sidecar', 'database']}).dependsOn).toEqual([
        'database',
      ])
    })

    test('removes configured environment variables', () => {
      envVarNames = new Set(['CUSTOM_VAR', 'ANOTHER_VAR'])
      const appContainer = {
        name: 'main',
        env: [
          {name: 'NODE_ENV', value: 'production'},
          {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
          {name: 'CUSTOM_VAR', value: 'custom-value'},
          {name: 'ANOTHER_VAR', value: 'another-value'},
          {name: 'KEEP_THIS', value: 'keep-me'},
        ],
        volumeMounts: [],
      }

      expect(cleanAppContainer(appContainer).env).toEqual([
        {name: 'NODE_ENV', value: 'production'},
        {name: 'KEEP_THIS', value: 'keep-me'},
      ])
    })

    test.each([
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ])('reports sidecar=%s and volume=%s removal independently', (hasSidecar, hasVolume) => {
      const result = uninstrumentServiceConfig(
        {
          template: {
            containers: [{name: 'main'}, ...(hasSidecar ? [{name: 'datadog-sidecar'}] : [])],
            volumes: hasVolume ? [{name: 'shared-volume'}] : [],
          },
        },
        {sidecarName: 'datadog-sidecar', sharedVolumeName: 'shared-volume', envVarNames: new Set()}
      )

      expect(result.sidecarRemoved).toBe(hasSidecar)
      expect(result.sharedVolumeRemoved).toBe(hasVolume)
    })
  })
})
