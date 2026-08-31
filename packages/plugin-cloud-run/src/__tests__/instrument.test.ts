import type {IContainer, IEnvVar, IVolumeMount} from '../types'

import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as apikey from '@datadog/datadog-ci-base/helpers/apikey'
import {API_KEY_ENV_VAR, SERVICE_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import * as instrumentHelpers from '@datadog/datadog-ci-base/helpers/serverless/source-code-integration'
import {SERVERLESS_CLI_VERSION_TAG_NAME} from '@datadog/datadog-ci-base/helpers/tags'

import {PluginCommand as InstrumentCommand} from '../commands/instrument'
import * as cloudRunPromptModule from '../prompt'
import * as serviceConfigModule from '../service-config'
import * as utils from '../utils'

jest.mock('@datadog/datadog-ci-base/helpers/apikey')
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  checkAuthentication: jest.fn(),
}))

jest.mock('@datadog/datadog-ci-base/helpers/serverless/source-code-integration')

jest.mock('@datadog/datadog-ci-base/version', () => ({cliVersion: '0.0.0'}))

const mockServicesClient = {
  servicePath: jest.fn(),
  getService: jest.fn(),
  updateService: jest.fn(),
}
jest.mock('@google-cloud/run', () => ({
  ServicesClient: jest.fn(() => mockServicesClient),
}))

describe('InstrumentCommand', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['cloud-run', 'instrument'])

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
    const mockValidator = {
      validateApiKey: jest.fn().mockResolvedValue(true),
      verifyApiKey: jest.fn().mockResolvedValue(undefined),
    }
    ;(apikey.newApiKeyValidator as jest.Mock).mockReturnValue(mockValidator)
    ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(true)

    // Reset mock client
    mockServicesClient.servicePath.mockImplementation(
      (project, region, service) => `projects/${project}/locations/${region}/services/${service}`
    )
  })

  describe('validates required variables', () => {
    test('should fail if project is missing', async () => {
      const {code, context} = await runCLI(['--services', 'test-service', '--region', 'us-central1'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('missing project')
    })

    test('should fail if services are missing', async () => {
      const {code, context} = await runCLI(['--project', 'test-project', '--region', 'us-central1'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('missing service(s)')
    })

    test('should fail if region is missing', async () => {
      const {code, context} = await runCLI(['--project', 'test-project', '--services', 'test-service'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('missing region')
    })
  })

  describe('main instrument command flow', () => {
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

    test('should fail if sidecar instrumentation fails', async () => {
      const mockInstrumentSidecar = jest.fn().mockRejectedValue(new Error('Failed to instrument sidecar'))
      jest.spyOn(InstrumentCommand.prototype as any, 'instrumentSidecar').mockImplementation(mockInstrumentSidecar)

      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain('Instrumentation failed: Failed to instrument sidecar')
      expect(context.stderr.toString()).not.toContain('Uninstrumentation failed')
    })

    test('should succeed with valid parameters', async () => {
      const mockInstrumentSidecar = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(InstrumentCommand.prototype as any, 'instrumentSidecar').mockImplementation(mockInstrumentSidecar)

      const {code} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(0)
      expect(mockInstrumentSidecar).toHaveBeenCalledWith('test-project', ['test-service'], 'us-central1', undefined)
    })
  })

  describe('automatic APM instrumentation', () => {
    const service = {
      name: 'projects/test-project/locations/us-central1/services/test-service',
      template: {
        containers: [{name: 'app', ports: [{containerPort: 8080}]}],
        volumes: [],
      },
    }
    const requiredFlags = [
      '--project',
      'test-project',
      '--services',
      'test-service',
      '--region',
      'us-central1',
      '--no-source-code-integration',
    ]

    test.each([
      [['--tracing', 'inject'], 'requires --language'],
      [['--tracer-version', 'latest'], 'require --tracing inject'],
      [['--tracer-volume-medium', 'disk'], 'require --tracing inject'],
      [['--tracing', 'inject', '--language', 'go'], 'dd-trace-go'],
      [['--tracing', 'inject', '--language', 'rust'], 'does not support language "rust"'],
    ])('rejects incompatible options before network calls: %s', async (flags, expected) => {
      const {code, context} = await runCLI([...requiredFlags, ...flags])

      expect(code).toBe(1)
      expect(context.stderr.toString()).toContain(expected)
      expect(apikey.newApiKeyValidator).not.toHaveBeenCalled()
      expect(utils.checkAuthentication).not.toHaveBeenCalled()
      expect(mockServicesClient.getService).not.toHaveBeenCalled()
    })

    test.each([
      ['--tracing', 'automatic'],
      ['--tracer-libc', 'bionic'],
      ['--tracer-version', 'bad/tag'],
      ['--tracer-volume-medium', 'ramdisk'],
    ])('rejects invalid %s values through Clipanion', async (flag, value) => {
      const {code} = await runCLI([...requiredFlags, flag, value])

      expect(code).toBe(1)
      expect(apikey.newApiKeyValidator).not.toHaveBeenCalled()
    })

    test.each([
      [undefined, undefined, 'no-injection'],
      ['true', 'true', 'no-injection'],
      ['1', '1', 'no-injection'],
      ['manual', 'true', 'no-injection'],
      ['false', 'false', 'no-injection'],
      ['0', '0', 'no-injection'],
      ['disabled', 'false', 'no-injection'],
      ['inject', 'true', 'single-language'],
    ])('normalizes --tracing %s', async (tracing, traceEnabled, configKind) => {
      mockServicesClient.getService.mockResolvedValue([service])
      const instrumentConfig = jest.spyOn(serviceConfigModule, 'instrumentServiceConfig')
      const tracingFlags = tracing === undefined ? [] : ['--tracing', tracing]
      const languageFlags = tracing === 'inject' ? ['--language', 'python'] : []

      const {code} = await runCLI([...requiredFlags, '--dry-run', ...tracingFlags, ...languageFlags])

      expect(code).toBe(0)
      const options = instrumentConfig.mock.calls[0][1]
      expect(options.ssiConfig?.kind).toBe(configKind)
      expect(options.envVarsByName.DD_TRACE_ENABLED?.value).toBe(traceEnabled)
    })

    test('--language sets the log source without automatic instrumentation', async () => {
      mockServicesClient.getService.mockResolvedValue([service])
      const instrumentConfig = jest.spyOn(serviceConfigModule, 'instrumentServiceConfig')

      const {code} = await runCLI([...requiredFlags, '--dry-run', '--language', 'python'])

      expect(code).toBe(0)
      const options = instrumentConfig.mock.calls[0][1]
      expect(options.ssiConfig?.kind).toBe('no-injection')
      expect(options.envVarsByName.DD_SOURCE?.value).toBe('python')
      expect(options.envVarsByName.DD_TRACE_ENABLED).toBeUndefined()
    })

    test('passes tracer tuning options to the service configuration', async () => {
      mockServicesClient.getService.mockResolvedValue([service])
      const instrumentConfig = jest.spyOn(serviceConfigModule, 'instrumentServiceConfig')

      const {code} = await runCLI([
        ...requiredFlags,
        '--dry-run',
        '--tracing',
        'inject',
        '--language',
        'python',
        '--tracer-version',
        '4.13.1',
        '--tracer-libc',
        'musl',
        '--tracer-readiness-port',
        '19000',
        '--tracer-volume-medium',
        'disk',
      ])

      expect(code).toBe(0)
      expect(instrumentConfig).toHaveBeenCalledWith(
        service,
        expect.objectContaining({
          tracerReadinessPort: 19000,
          ssiConfig: expect.objectContaining({
            kind: 'single-language',
            language: 'python',
            libc: 'musl',
            tracerVolumeMedium: 'disk',
            spec: expect.objectContaining({image: 'gcr.io/datadoghq/dd-lib-python-init:4.13.1'}),
          }),
        })
      )
    })

    test('renders service configuration failures once without a stack trace', async () => {
      mockServicesClient.getService.mockResolvedValue([
        {
          ...service,
          template: {
            containers: [
              {name: 'app', ports: [{containerPort: 8080}]},
              {name: 'admin', ports: [{containerPort: 9090}]},
            ],
          },
        },
      ])

      const {code, context} = await runCLI([
        ...requiredFlags,
        '--dry-run',
        '--tracing',
        'inject',
        '--language',
        'python',
      ])
      const errorOutput = context.stderr.toString()

      expect(code).toBe(1)
      expect(errorOutput.match(/Instrumentation failed:/g)).toHaveLength(1)
      expect(errorOutput).toContain('multiple containers declare ports')
      expect(errorOutput).not.toContain('SsiConfigError')
      expect(errorOutput).not.toContain('at PluginCommand')
    })
  })

  describe('snapshot tests', () => {
    const mockService = {
      name: 'projects/test-project/locations/us-central1/services/test-service',
      template: {
        containers: [
          {
            name: 'main-app',
            image: 'gcr.io/test-project/test-app:latest',
            env: [{name: 'NODE_ENV', value: 'production'}],
            volumeMounts: [],
          },
        ],
        volumes: [],
        revision: 'test-service-v1',
      },
    }

    beforeEach(() => {
      process.env[API_KEY_ENV_VAR] = 'test-api-key'
      process.env[SERVICE_ENV_VAR] = 'test-service'

      mockServicesClient.getService.mockResolvedValue([mockService])

      const mockOperation = {
        promise: jest.fn().mockResolvedValue([]),
      }
      mockServicesClient.updateService.mockResolvedValue([mockOperation])

      jest.restoreAllMocks()

      const mockValidator = {
        validateApiKey: jest.fn().mockResolvedValue(true),
        verifyApiKey: jest.fn().mockResolvedValue(undefined),
      }
      ;(apikey.newApiKeyValidator as jest.Mock).mockReturnValue(mockValidator)
      ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(true)

      // Re-apply git status mock after restoreAllMocks
      const mockGitStatus = jest.spyOn(instrumentHelpers as any, 'getCurrentGitStatus')
      mockGitStatus.mockImplementation(async () => ({
        ahead: 0,
        hash: '1be168ff837f043bde17c0314341c84271047b31',
        remote: 'git.repository_url:git@github.com:datadog/test.git',
        isClean: true,
        files: [],
      }))
    })

    test('prints dry run data with basic flags', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
        '--dry-run',
        '--env',
        'staging',
        '--version',
        '1.0.0',
        '--extra-tags',
        'team:backend,service:api',
        '--no-upload-git-metadata',
      ])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })

    test('interactive mode', async () => {
      // Mock the prompts to return values
      jest.spyOn(cloudRunPromptModule, 'requestGCPProject').mockResolvedValue('interactive-project')
      jest.spyOn(cloudRunPromptModule, 'requestGCPRegion').mockResolvedValue('us-west1')
      jest.spyOn(cloudRunPromptModule, 'requestServiceName').mockResolvedValue('interactive-service')
      jest.spyOn(cloudRunPromptModule, 'requestSite').mockResolvedValue('datadoghq.com')
      jest.spyOn(cloudRunPromptModule, 'requestConfirmation').mockResolvedValue(true)

      // Mock the service for interactive mode
      const interactiveService = {
        ...mockService,
        name: 'projects/interactive-project/locations/us-west1/services/interactive-service',
      }
      mockServicesClient.getService.mockResolvedValue([interactiveService])

      const {code, context} = await runCLI(['--interactive', '--no-upload-git-metadata'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toMatchSnapshot()
    })
  })

  describe('createInstrumentedServiceConfig', () => {
    let command: InstrumentCommand

    beforeEach(() => {
      command = new InstrumentCommand()
      ;(command as any).tracing = undefined
      ;(command as any).tracerVersion = undefined
      ;(command as any).tracerLibc = undefined
      ;(command as any).tracerVolumeMedium = undefined
      ;(command as any).sidecarImage = 'gcr.io/datadoghq/serverless-init:latest'
      ;(command as any).sidecarName = 'datadog-sidecar'
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).sharedVolumePath = '/shared-volume'
      ;(command as any).logsPath = '/shared-volume/logs/*.log'
      ;(command as any).environment = undefined
      ;(command as any).version = undefined
      ;(command as any).envVars = []
    })

    test('adds sidecar and shared volume when missing', () => {
      const service = {
        template: {
          containers: [{name: 'main', env: [], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-dd-service')

      // should have original + sidecar
      expect(result.template?.containers).toHaveLength(2)
      expect(result.template?.containers?.map((c: IContainer) => c.name)).toEqual(['main', 'datadog-sidecar'])

      // main container should get the shared volume mount
      const main = result.template?.containers?.find((c: IContainer) => c.name === 'main')
      expect(main?.volumeMounts?.some((vm: IVolumeMount) => vm.mountPath === '/shared-volume')).toBe(true)

      // should add the shared-volume
      expect(result.template?.volumes).toHaveLength(1)
      expect(result.template?.volumes?.[0].name).toBe('shared-volume')
    })

    test('does not add duplicate sidecar or volume when app and sidecar already present', () => {
      const appContainer = {
        name: 'app',
        env: [{name: SERVICE_ENV_VAR, value: 'old-service'}],
        volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
      }

      const sidecarContainer = {
        name: 'datadog-sidecar',
        env: [],
        volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
      }

      const existingVolume = {name: 'shared-volume', emptyDir: {}}

      const service = {
        template: {
          containers: [appContainer, sidecarContainer],
          volumes: [existingVolume],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-dd-service')

      // should not add another sidecar
      expect(result.template?.containers).toHaveLength(2)
      expect(result.template?.containers?.map((c: IContainer) => c.name)).toEqual(['app', 'datadog-sidecar'])

      // should not add another shared-volume
      expect(result.template?.volumes).toHaveLength(1)
      expect(result.template?.volumes?.[0].name).toBe('shared-volume')
    })

    test('uses custom configuration values', () => {
      ;(command as any).sidecarImage = 'custom-image:v1.0'
      ;(command as any).sidecarName = 'custom-sidecar'
      ;(command as any).sharedVolumeName = 'custom-volume'
      ;(command as any).sharedVolumePath = '/custom/path'
      ;(command as any).logsPath = '/custom/path/logs/*.log'
      ;(command as any).sidecarCpus = '2'
      ;(command as any).sidecarMemory = '256Mi'

      const service = {
        template: {
          containers: [{name: 'main', env: [], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'test-service')

      // Check sidecar container has custom values
      const sidecarContainer = result.template?.containers?.find((c: IContainer) => c.name === 'custom-sidecar')
      expect(sidecarContainer).toBeDefined()
      expect(sidecarContainer?.image).toBe('custom-image:v1.0')
      expect(sidecarContainer?.name).toBe('custom-sidecar')
      expect(sidecarContainer?.volumeMounts?.[0]?.name).toBe('custom-volume')
      expect(sidecarContainer?.volumeMounts?.[0]?.mountPath).toBe('/custom/path')
      expect(sidecarContainer?.env?.find((e: IEnvVar) => e.name === 'DD_SERVERLESS_LOG_PATH')?.value).toBe(
        '/custom/path/logs/*.log'
      )
      expect(sidecarContainer?.resources?.limits?.cpu).toBe('2')
      expect(sidecarContainer?.resources?.limits?.memory).toBe('256Mi')

      // Check main container has custom volume mount
      const mainContainer = result.template?.containers?.find((c: IContainer) => c.name === 'main')
      expect(mainContainer?.volumeMounts?.[0]?.name).toBe('custom-volume')
      expect(mainContainer?.volumeMounts?.[0]?.mountPath).toBe('/custom/path')

      // Check custom volume is created
      expect(result.template?.volumes?.[0]?.name).toBe('custom-volume')
    })

    test('sets unified service tag label', () => {
      const service = {
        template: {
          containers: [{name: 'main', env: [], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-service')

      expect(result.labels).toEqual({
        service: 'my-service',
        [SERVERLESS_CLI_VERSION_TAG_NAME]: 'v0_0_0',
      })
    })

    test('preserves existing labels and adds service tag', () => {
      const service = {
        labels: {
          'existing-label': 'existing-value',
          team: 'backend',
        },
        template: {
          containers: [{name: 'main', env: [], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-service')

      expect(result.labels).toEqual({
        'existing-label': 'existing-value',
        team: 'backend',
        service: 'my-service',
        [SERVERLESS_CLI_VERSION_TAG_NAME]: 'v0_0_0',
      })
    })

    test('adds custom environment variables to main container', () => {
      ;(command as any).envVars = ['CUSTOM_VAR=custom-value', 'ANOTHER_VAR=another-value']

      const service = {
        template: {
          containers: [{name: 'main', env: [{name: 'EXISTING_VAR', value: 'existing-value'}], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-service')

      const mainContainer = result.template?.containers?.find((c: IContainer) => c.name === 'main')
      expect(mainContainer?.env).toContainEqual({name: 'CUSTOM_VAR', value: 'custom-value'})
      expect(mainContainer?.env).toContainEqual({name: 'ANOTHER_VAR', value: 'another-value'})
      expect(mainContainer?.env).toContainEqual({name: 'EXISTING_VAR', value: 'existing-value'})
    })

    test('handles empty envVars array', () => {
      ;(command as any).envVars = []

      const service = {
        template: {
          containers: [{name: 'main', env: [], volumeMounts: []}],
          volumes: [],
        },
      }

      const result = command.createInstrumentedServiceConfig(service, 'my-service')

      // Should not throw and should work normally
      expect(result.template?.containers).toHaveLength(2)
    })
  })
})
