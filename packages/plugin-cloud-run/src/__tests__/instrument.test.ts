// XXX temporary workaround for @google-cloud/run ESM/CJS module issues
import type {IContainer, IEnvVar, IVolumeMount} from '../types'

import {
  API_KEY_ENV_VAR,
  DATADOG_SITE_EU1,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  HEALTH_PORT_ENV_VAR,
  DD_LOG_LEVEL_ENV_VAR,
  LOGS_INJECTION_ENV_VAR,
  LOGS_PATH_ENV_VAR,
  SERVICE_ENV_VAR,
  SITE_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  VERSION_ENV_VAR,
  DD_SOURCE_ENV_VAR,
} from '@datadog/datadog-ci-base/constants'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as apikey from '@datadog/datadog-ci-base/helpers/apikey'

import * as instrumentHelpers from '@datadog/datadog-ci-base/helpers/git-source-integration'

import {InstrumentCommand} from '../instrument'
import * as cloudRunPromptModule from '../prompt'
import * as utils from '../utils'

jest.mock('@datadog/datadog-ci-base/helpers/apikey')
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  checkAuthentication: jest.fn(),
}))

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

      const {code} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(1)
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
      ;(command as any).sidecarImage = 'gcr.io/datadoghq/serverless-init:latest'
      ;(command as any).sidecarName = 'datadog-sidecar'
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).sharedVolumePath = '/shared-volume'
      ;(command as any).logsPath = '/shared-volume/logs/*.log'
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
  })

  describe('buildSidecarContainer', () => {
    let command: InstrumentCommand

    beforeEach(() => {
      command = new InstrumentCommand()
      ;(command as any).tracing = undefined
      ;(command as any).sidecarImage = 'gcr.io/datadoghq/serverless-init:latest'
      ;(command as any).sidecarName = 'datadog-sidecar'
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).sharedVolumePath = '/shared-volume'
      ;(command as any).logsPath = '/shared-volume/logs/*.log'
    })

    test('custom flags set correct env vars', () => {
      ;(command as any).environment = 'dev'
      ;(command as any).version = 'v123.456'
      ;(command as any).logLevel = 'debug'
      ;(command as any).llmobs = 'my-llm-app'
      ;(command as any).extraTags = 'foo:bar,abc:def'
      ;(command as any).language = 'nodejs'

      const newSidecarContainer = command.buildSidecarContainer(undefined, 'my-service')
      const expected: IEnvVar[] = [
        {name: SERVICE_ENV_VAR, value: 'my-service'},
        {name: ENVIRONMENT_ENV_VAR, value: 'dev'},
        {name: VERSION_ENV_VAR, value: 'v123.456'},
        {name: SITE_ENV_VAR, value: 'datadoghq.com'},
        {name: LOGS_PATH_ENV_VAR, value: (command as any).logsPath as string},
        {name: API_KEY_ENV_VAR, value: process.env.DD_API_KEY ?? ''},
        {name: HEALTH_PORT_ENV_VAR, value: '5555'},
        {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
        {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
        {name: DD_LOG_LEVEL_ENV_VAR, value: 'debug'},
        {name: DD_TAGS_ENV_VAR, value: 'foo:bar,abc:def'},
        {name: DD_SOURCE_ENV_VAR, value: 'nodejs'},
      ]
      expect(newSidecarContainer.env).toEqual(expect.arrayContaining(expected))
      expect(newSidecarContainer.env).toHaveLength(expected.length)
    })

    test('overwrites intended env vars; leaves existing env vars unchanged', () => {
      process.env[API_KEY_ENV_VAR] = 'mock-api-key'
      const existingSidecarContainer = {
        name: 'datadog-sidecar',
        env: [
          // Following env vars should be left unchanged
          {name: SITE_ENV_VAR, value: DATADOG_SITE_EU1},
          {name: LOGS_PATH_ENV_VAR, value: 'some-log-path'},
          {name: LOGS_INJECTION_ENV_VAR, value: 'false'},
          {name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'},
          {name: HEALTH_PORT_ENV_VAR, value: '12345'},
          {name: 'CUSTOM_ENV_VAR', value: 'some-value'},
          // Following env vars should be overwritten
          {name: API_KEY_ENV_VAR, value: '123'},
          {name: SERVICE_ENV_VAR, value: 'old-service'},
        ],
        volumeMounts: [{name: 'shared-volume', mountPath: '/shared-volume'}],
      }
      const newSidecarContainer = command.buildSidecarContainer(existingSidecarContainer, 'new-service')
      const expected: IEnvVar[] = [
        {name: SITE_ENV_VAR, value: DATADOG_SITE_EU1},
        {name: LOGS_PATH_ENV_VAR, value: '/shared-volume/logs/*.log'},
        {name: LOGS_INJECTION_ENV_VAR, value: 'false'},
        {name: DD_TRACE_ENABLED_ENV_VAR, value: 'false'},
        {name: HEALTH_PORT_ENV_VAR, value: '12345'},
        {name: 'CUSTOM_ENV_VAR', value: 'some-value'},
        {name: API_KEY_ENV_VAR, value: 'mock-api-key'},
        {name: SERVICE_ENV_VAR, value: 'new-service'},
      ]
      for (const expectedEnv of expected) {
        const actual = newSidecarContainer.env?.find((value) => value.name === expectedEnv.name)
        expect(actual?.value).toBe(expectedEnv.value)
      }
    })
  })
})
