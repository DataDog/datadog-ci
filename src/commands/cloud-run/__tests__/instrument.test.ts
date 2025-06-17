import IContainer = google.cloud.run.v2.IContainer
import IVolumeMount = google.cloud.run.v2.IVolumeMount

import {ServicesClient} from '@google-cloud/run'
import {google} from '@google-cloud/run/build/protos/protos'

import {SERVICE_ENV_VAR} from '../../../constants'
import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import * as apikey from '../../../helpers/apikey'

import {InstrumentCommand} from '../instrument'
import * as utils from '../utils'

jest.mock('../../../helpers/apikey')
jest.mock('../utils')

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
  })

  describe('validates required variables', () => {
    test('should fail if project is missing', async () => {
      const {code, context} = await runCLI([
        '--services',
        'test-service',
        '--region',
        'us-central1',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No project specified')
    })

    test('should fail if services are missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--region',
        'us-central1',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No services specified')
    })

    test('should fail if region is missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No region specified')
    })

    test('should fail if DD_SERVICE is missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No DD_SERVICE specified')
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
        '--dd-service',
        'test-service',
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
        '--dd-service',
        'test-service',
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
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(0)
      expect(mockInstrumentSidecar).toHaveBeenCalledWith(
        'test-project',
        ['test-service'],
        'us-central1',
        'test-service'
      )
    })
  })

  describe('instrumentService', () => {
    let command: InstrumentCommand
    let mockClient: Partial<ServicesClient>
    const mockServicePath = 'projects/project/locations/region/services/service'

    beforeEach(() => {
      command = new InstrumentCommand()
      // inject a fake context so we can spy on writes
      command.context = {
        stdout: {write: jest.fn()},
        stderr: {write: jest.fn()},
      } as any

      mockClient = {
        servicePath: jest.fn().mockReturnValue(mockServicePath),
        getService: jest.fn().mockResolvedValue([{template: {}, containers: [], volumes: []}]),
        updateService: jest.fn().mockResolvedValue([
          {
            promise: jest.fn().mockResolvedValue(undefined),
          },
        ]),
      }
    })

    test('should fetch, transform, and update the service successfully', async () => {
      const fakeUpdated = {template: {foo: 'bar'}}
      jest.spyOn(command as any, 'createInstrumentedServiceConfig').mockReturnValue(fakeUpdated)

      await command.instrumentService(mockClient as ServicesClient, 'project', 'service', 'region', 'ddService')

      expect(mockClient.updateService).toHaveBeenCalledWith({
        service: fakeUpdated,
      })
    })

    test('should throw error when the service does not exist', async () => {
      ;(mockClient.getService as jest.Mock).mockRejectedValue(new Error('not found'))

      await expect(
        command.instrumentService(mockClient as ServicesClient, 'project', 'service', 'region', 'ddService')
      ).rejects.toThrow('Service service not found in project project, region region')
    })

    test('should propagate errors from updateService', async () => {
      ;(mockClient.updateService as jest.Mock).mockResolvedValue([
        {
          promise: jest.fn().mockRejectedValue(new Error('update failed')),
        },
      ])

      await expect(
        command.instrumentService(mockClient as ServicesClient, 'project', 'service', 'region', 'ddService')
      ).rejects.toThrow('update failed')
    })
  })

  describe('createInstrumentedServiceConfig', () => {
    let command: InstrumentCommand

    beforeEach(() => {
      command = new InstrumentCommand()
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
      const main = result.template?.containers?.find((c) => c.name === 'main')
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
  })
})
