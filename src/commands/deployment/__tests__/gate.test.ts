import {createCommand, makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import * as apiModule from '../api'
import {DeploymentGateCommand} from '../gate'

const buildEvaluationRequestResponse = (evaluationId: string) => ({
  data: {
    data: {
      attributes: {
        evaluation_id: evaluationId,
      },
    },
  },
})

const buildGateEvaluationResultResponse = (status: string, rules: {status: string}[] = []) => ({
  data: {
    data: {
      attributes: {
        gate_status: status,
        rules,
      },
    },
  },
})

describe('gate', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentGateCommand, ['deployment', 'gate'], {skipResetEnv: true})

    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
      originalEnv = {...process.env}
      process.env.DATADOG_SITE = 'datadoghq.com'
      process.env.DATADOG_API_KEY = 'test-api-key'
      process.env.DATADOG_APP_KEY = 'test-app-key'

      jest.useFakeTimers()
    })

    afterEach(() => {
      process.env = originalEnv
      jest.useRealTimers()
      jest.clearAllMocks()
    })

    describe('validation', () => {
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
    })

    describe('successful evaluation', () => {
      test('should succeed when gate evaluation passes on first poll', async () => {
        const mockApi = {
          requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest.fn().mockResolvedValue(buildGateEvaluationResultResponse('pass')),
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

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({
          service: 'test-service',
          env: 'prod',
          identifier: 'default',
        })
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledWith('test-evaluation-id')
      })

      test('should pass when gate evaluation passes after multiple in_progress calls', async () => {
        const mockApi = {
          requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest
            .fn()
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('in_progress'))
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('in_progress'))
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('pass')),
        }

        const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

        const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

        // Run all timers and wait for all pending promises to resolve
        await jest.runAllTimersAsync()

        const {context, code} = await runPromise

        expect(code).toBe(0)
        expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
        expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
        expect(context.stdout.toString()).toContain(
          'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
        )
        expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
        expect(context.stdout.toString()).toContain('Gate evaluation passed')

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({
          service: 'test-service',
          env: 'prod',
          identifier: 'default',
        })
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(1, 'test-evaluation-id')
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(2, 'test-evaluation-id')
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(3, 'test-evaluation-id')
      })

      test('should fail when gate evaluation fails', async () => {
        const mockApi = {
          requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest.fn().mockResolvedValue(buildGateEvaluationResultResponse('fail')),
        }

        const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

        const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

        expect(code).toBe(1)
        expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
        expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
        expect(context.stdout.toString()).toContain(
          'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
        )
        expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
        expect(context.stdout.toString()).toContain('Gate evaluation failed')

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({
          service: 'test-service',
          env: 'prod',
          identifier: 'default',
        })
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledWith('test-evaluation-id')
      })
    })

    describe('evaluation errors', () => {
      describe('on gate evaluation request', () => {
        test('should fail when gate evaluation request fails with 400', async () => {
          const mockError = Object.assign(new Error('Request failed with status code 400'), {
            isAxiosError: true,
            response: {
              status: 400,
              statusText: 'Bad Request',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockRejectedValue(mockError),
            getGateEvaluationResult: jest.fn(),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

          expect(code).toBe(1)
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain('Request failed with client error: 400 Bad Request')
          expect(context.stdout.toString()).toContain('Request failed with client error, exiting with status 1')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).not.toHaveBeenCalled()
        })

        test('should pass when gate evaluation request fails with 500', async () => {
          const mockError = Object.assign(new Error('Request failed with status code 500'), {
            isAxiosError: true,
            response: {
              status: 500,
              statusText: 'Internal Server Error',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockRejectedValue(mockError),
            getGateEvaluationResult: jest.fn(),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

          expect(code).toBe(0)
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain('Deployment gate evaluation failed:')
          expect(context.stdout.toString()).toContain('Unexpected error happened, exiting with status 0')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).not.toHaveBeenCalled()
        })

        test('should fail when gate evaluation request fails with 500 and fail-on-error is true', async () => {
          const mockError = Object.assign(new Error('Request failed with status code 500'), {
            isAxiosError: true,
            response: {
              status: 500,
              statusText: 'Internal Server Error',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockRejectedValue(mockError),
            getGateEvaluationResult: jest.fn(),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod', '--fail-on-error'])

          expect(code).toBe(1)
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain('Deployment gate evaluation failed:')
          expect(context.stdout.toString()).toContain('Unexpected error happened, exiting with status 1')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).not.toHaveBeenCalled()
        })
      })

      describe('on gate evaluation result', () => {
        test('pass with a 500 error', async () => {
          const mockError = new Error('API Error')
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest.fn().mockRejectedValue(mockError),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

          expect(code).toBe(0) // Default behavior when fail-on-error is false
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain(
            'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
          )
          expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
          expect(context.stdout.toString()).toContain('Error polling for gate evaluation results: API Error')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        })

        test('should fail with 500 error when fail-on-error is true', async () => {
          const mockError = Object.assign(new Error('Request failed with status code 500'), {
            isAxiosError: true,
            response: {
              status: 500,
              statusText: 'Internal Server Error',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest.fn().mockRejectedValue(mockError),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod', '--fail-on-error'])

          expect(code).toBe(1)
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain(
            'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
          )
          expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
          expect(context.stdout.toString()).toContain(
            'Error polling for gate evaluation results: Request failed with status code 500'
          )
          expect(context.stdout.toString()).toContain('Unexpected error happened, exiting with status 1')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        })

        test('should handle invalid evaluation status', async () => {
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest.fn().mockResolvedValue(buildGateEvaluationResultResponse('expired')),
          }

          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

          expect(code).toBe(0) // Default behavior when fail-on-error is false
          expect(context.stdout.toString()).toContain('Starting deployment gate evaluation')
          expect(context.stdout.toString()).toContain('Requesting gate evaluation...')
          expect(context.stdout.toString()).toContain(
            'Gate evaluation started successfully. Evaluation ID: test-evaluation-id'
          )
          expect(context.stdout.toString()).toContain('Waiting for gate evaluation results...')
          expect(context.stdout.toString()).toContain('Unknown gate evaluation status: expired')

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        })
      })
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
