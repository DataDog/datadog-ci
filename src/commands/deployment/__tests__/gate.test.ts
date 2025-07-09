import {createCommand, makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import * as apiModule from '../api'
import {DeploymentGateCommand} from '../gate'

describe('gate', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentGateCommand, ['deployment', 'gate'], {skipResetEnv: true})

    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
      originalEnv = {...process.env}
      process.env.DATADOG_API_KEY = 'test-api-key'
      process.env.DATADOG_APP_KEY = 'test-app-key'

      jest.useFakeTimers()
    })

    afterEach(() => {
      process.env = originalEnv
      jest.useRealTimers()
      jest.clearAllMocks()
    })

    test('should fail if service is not provided', async () => {
      const {context, code} = await runCLI(['--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Missing required parameter: --service')
    })

    test('should fail if env is not provided', async () => {
      const {context, code} = await runCLI(['--service', 'test-service'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Missing required parameter: --env')
    })

    test('should fail if API key is not provided', async () => {
      delete process.env.DATADOG_API_KEY
      delete process.env.DD_API_KEY

      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Neither DATADOG_API_KEY nor DD_API_KEY are in your environment')
    })

    test('should fail if APP key is not provided', async () => {
      delete process.env.DATADOG_APP_KEY
      delete process.env.DD_APP_KEY

      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Neither DATADOG_APP_KEY nor DD_APP_KEY are in your environment')
    })

    test('should fail if timeout is invalid', async () => {
      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod', '--timeout', 'invalid'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Invalid --timeout value. Must be a positive integer.')
    })

    test('should succeed when gate evaluation passes on first poll', async () => {
      const mockApi = {
        requestGateEvaluation: jest.fn().mockResolvedValue({
          data: {
            data: {
              attributes: {
                evaluation_id: 'test-evaluation-id',
              },
            },
          },
        }),
        getGateEvaluationResult: jest.fn().mockResolvedValue({
          data: {
            data: {
              attributes: {
                gate_status: 'pass',
              },
            },
          },
        }),
      }

      const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

      expect(code).toBe(0)
      expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
      expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
      expect(context.stdout.toString()).toContain(
        'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
      )
      expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
      expect(context.stdout.toString()).toContain('Gate evaluation passed')

      expect(apiConstructorSpy).toHaveBeenCalledWith('https://app.datad0g.com', 'test-api-key', 'test-app-key')
      expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
      expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
      })
      expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
      expect(mockApi.getGateEvaluationResult).toHaveBeenCalledWith('test-evaluation-id')
    })

    test('should fail when gate evaluation fails after in_progress', async () => {
      const mockApi = {
        requestGateEvaluation: jest.fn().mockResolvedValue({
          data: {
            data: {
              attributes: {
                evaluation_id: 'test-evaluation-id',
              },
            },
          },
        }),
        getGateEvaluationResult: jest
          .fn()
          .mockResolvedValueOnce({
            data: {
              data: {
                attributes: {
                  gate_status: 'in_progress',
                },
              },
            },
          })
          .mockResolvedValueOnce({
            data: {
              data: {
                attributes: {
                  gate_status: 'fail',
                },
              },
            },
          }),
      }

      const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

      const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

      // Run all timers and wait for all pending promises to resolve
      await jest.runAllTimersAsync()

      const {context, code} = await runPromise

      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
      expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
      expect(context.stdout.toString()).toContain(
        'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
      )
      expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
      expect(context.stdout.toString()).toContain('Gate evaluation failed')

      expect(apiConstructorSpy).toHaveBeenCalledWith('https://app.datad0g.com', 'test-api-key', 'test-app-key')
      expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
      expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
      })
      expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(2)
      expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(1, 'test-evaluation-id')
      expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(2, 'test-evaluation-id')
    })
  })

  describe('buildEvaluationRequest', () => {
    test('should build basic request with required parameters', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
      })
    })

    test('should include version when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['version'] = '1.2.3'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        version: '1.2.3',
      })
    })

    test('should include apm_primary_tag when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['apmPrimaryTag'] = 'team:backend'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        apm_primary_tag: 'team:backend',
      })
    })

    test('should include both version and apm_primary_tag when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['version'] = '1.2.3'
      command['apmPrimaryTag'] = 'team:backend'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        version: '1.2.3',
        apm_primary_tag: 'team:backend',
      })
    })
  })
})
