// XXX temporary workaround for @google-cloud/run ESM/CJS module issues
import type {IContainer} from '../types'

import {
  API_KEY_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  DD_TAGS_ENV_VAR,
  DD_TRACE_ENABLED_ENV_VAR,
  SERVICE_ENV_VAR,
} from '@datadog/datadog-ci-base/constants'
import {makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import * as cloudRunPromptModule from '../prompt'
import {PluginCommand as UninstrumentCommand} from '../uninstrument'
import * as utils from '../utils'

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
    const mockService = {
      name: 'projects/test-project/locations/us-central1/services/test-service',
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

    beforeEach(() => {
      command = new UninstrumentCommand()
      ;(command as any).sidecarName = 'datadog-sidecar'
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).context = {
        stdout: {write: jest.fn()},
        stderr: {write: jest.fn()},
      }
    })

    test('removes sidecar container, shared volume, and DD_ env vars', () => {
      const service = {
        template: {
          containers: [
            {
              name: 'main',
              env: [
                {name: 'NODE_ENV', value: 'production'},
                {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
                {name: ENVIRONMENT_ENV_VAR, value: 'staging'},
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

  describe('updateAppContainer', () => {
    let command: UninstrumentCommand

    beforeEach(() => {
      command = new UninstrumentCommand()
      ;(command as any).sharedVolumeName = 'shared-volume'
      ;(command as any).context = {
        stdout: {write: jest.fn()},
        stderr: {write: jest.fn()},
      }
    })

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

      const result = (command as any).updateAppContainer(appContainer)

      expect(result.volumeMounts).toEqual([{name: 'other-volume', mountPath: '/other'}])
      expect(result.env).toEqual([
        {name: 'NODE_ENV', value: 'production'},
        {name: 'CUSTOM_VAR', value: 'keep-me'},
      ])
    })

    test('handles container with undefined env and volumeMounts', () => {
      const appContainer = {name: 'main'}
      const result = (command as any).updateAppContainer(appContainer)

      expect(result.volumeMounts).toEqual([])
      expect(result.env).toEqual([])
    })
  })
})
