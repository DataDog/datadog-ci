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
} from '../../../constants'
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

  describe('createInstrumentedServiceConfig', () => {
    let command: InstrumentCommand

    beforeEach(() => {
      command = new InstrumentCommand()
      ;(command as any).tracing = undefined
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
  })

  describe('buildSidecarContainer', () => {
    let command: InstrumentCommand

    beforeEach(() => {
      command = new InstrumentCommand()
      ;(command as any).tracing = undefined
    })

    test('custom flags set correct env vars', () => {
      ;(command as any).environment = 'dev'
      ;(command as any).version = 'v123.456'
      ;(command as any).logLevel = 'debug'
      ;(command as any).llmobs = 'my-llm-app'
      ;(command as any).extraTags = 'foo:bar,abc:def'

      const newSidecarContainer = command.buildSidecarContainer(undefined, 'my-service')
      const expected: IEnvVar[] = [
        {name: SERVICE_ENV_VAR, value: 'my-service'},
        {name: ENVIRONMENT_ENV_VAR, value: 'dev'},
        {name: VERSION_ENV_VAR, value: 'v123.456'},
        {name: SITE_ENV_VAR, value: 'datadoghq.com'},
        {name: LOGS_PATH_ENV_VAR, value: '/shared-volume/logs/*.log'},
        {name: API_KEY_ENV_VAR, value: process.env.DD_API_KEY ?? ''},
        {name: HEALTH_PORT_ENV_VAR, value: '5555'},
        {name: LOGS_INJECTION_ENV_VAR, value: 'true'},
        {name: DD_TRACE_ENABLED_ENV_VAR, value: 'true'},
        {name: DD_LOG_LEVEL_ENV_VAR, value: 'debug'},
        {name: DD_TAGS_ENV_VAR, value: 'foo:bar,abc:def'},
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
        {name: LOGS_PATH_ENV_VAR, value: 'some-log-path'},
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
