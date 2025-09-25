import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import * as apiModule from '../api'
import {PluginCommand as DeploymentGateCommand} from '../commands/gate'

const buildEvaluationRequestResponse = (evaluationId: string) => ({
  data: {
    data: {
      attributes: {
        evaluation_id: evaluationId,
      },
    },
  },
})

const buildGateEvaluationResultResponse = (status: string, ruleStatuses: string[] | undefined = ['pass']) => {
  const rules = ruleStatuses.map((ruleStatus, index) => ({
    name: `Rule ${index + 1}`,
    status: ruleStatus,
    reason: ruleStatus === 'fail' ? `Failure reason ${index + 1}` : '',
  }))

  return {
    data: {
      data: {
        attributes: {
          gate_status: status,
          evaluation_url: 'https://app.datadoghq.com/ci/deployment-gates/evaluations?query=evaluation_id%3A123456',
          rules,
        },
      },
    },
  }
}

describe('gate', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentGateCommand, ['deployment', 'gate'], {skipResetEnv: true})

    let originalEnv: NodeJS.ProcessEnv

    beforeEach(() => {
      originalEnv = {...process.env}
      process.env.DATADOG_SITE = ''
      process.env.DATADOG_API_KEY = ''
      process.env.DATADOG_APP_KEY = ''
      process.env.DD_SITE = 'datadoghq.com'
      process.env.DD_API_KEY = 'test-api-key'
      process.env.DD_APP_KEY = 'test-app-key'

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
        expect(context.stdout.toString()).toMatchSnapshot()

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({service: 'test-service', env: 'prod'})
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledWith('test-evaluation-id')
      })

      test('should pass when gate evaluation passes after multiple in_progress calls', async () => {
        const mockApi = {
          requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest
            .fn()
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('in_progress', ['in_progress', 'in_progress']))
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('in_progress', ['in_progress', 'pass']))
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('pass', ['pass', 'pass'])),
        }
        const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

        const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

        // Run all timers and wait for all pending promises to resolve
        await jest.runAllTimersAsync()

        const {context, code} = await runPromise

        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({service: 'test-service', env: 'prod'})
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(1, 'test-evaluation-id')
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(2, 'test-evaluation-id')
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(3, 'test-evaluation-id')
      })

      test('should fail when gate evaluation fails', async () => {
        const mockApi = {
          requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest
            .fn()
            .mockResolvedValue(buildGateEvaluationResultResponse('fail', ['fail', 'in_progress', 'pass'])),
        }
        const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

        const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])

        expect(code).toBe(1)
        expect(context.stdout.toString()).toMatchSnapshot()

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledWith({service: 'test-service', env: 'prod'})
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(1)
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledWith('test-evaluation-id')
      })

      test('should succeed when requests fail but succeed on retry', async () => {
        const mockError = Object.assign(new Error('Request failed with status code 500'), {
          isAxiosError: true,
          response: {
            status: 500,
            statusText: 'Internal Server Error',
          },
        })

        const mockApi = {
          requestGateEvaluation: jest
            .fn()
            .mockRejectedValueOnce(mockError)
            .mockResolvedValueOnce(buildEvaluationRequestResponse('test-evaluation-id')),
          getGateEvaluationResult: jest
            .fn()
            .mockRejectedValueOnce(mockError)
            .mockResolvedValueOnce(buildGateEvaluationResultResponse('pass')),
        }
        const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

        const runPromise = runCLI(['--service', 'test-service', '--env', 'prod', '--timeout', '30'])

        await jest.runAllTimersAsync()

        const {context, code} = await runPromise

        expect(code).toBe(0)
        expect(context.stdout.toString()).toMatchSnapshot()

        expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
        expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(2)
        expect(mockApi.requestGateEvaluation).toHaveBeenNthCalledWith(1, {service: 'test-service', env: 'prod'})
        expect(mockApi.requestGateEvaluation).toHaveBeenNthCalledWith(2, {service: 'test-service', env: 'prod'})
        expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(2)
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(1, 'test-evaluation-id')
        expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(2, 'test-evaluation-id')
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
          expect(context.stdout.toString()).toMatchSnapshot()

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

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(0)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(6)
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

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod', '--fail-on-error'])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(1)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(6)
          expect(mockApi.getGateEvaluationResult).not.toHaveBeenCalled()
        })
      })

      describe('on gate evaluation result', () => {
        test('pass with a 500 error', async () => {
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

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod', '--timeout', '60'])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(0)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(5)
        })

        test('pass with a 404 error', async () => {
          const mockError = Object.assign(new Error('Gate evaluation not found'), {
            isAxiosError: true,
            response: {
              status: 404,
              statusText: 'Not Found',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest.fn().mockRejectedValue(mockError),
          }
          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod', '--timeout', '30'])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(0)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
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

          const runPromise = runCLI([
            '--service',
            'test-service',
            '--env',
            'prod',
            '--timeout',
            '30',
            '--fail-on-error',
          ])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(1)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
        })

        test('should fail with 404 error when fail-on-error is true', async () => {
          const mockError = Object.assign(new Error('Gate evaluation not found'), {
            isAxiosError: true,
            response: {
              status: 404,
              statusText: 'Not Found',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest.fn().mockRejectedValue(mockError),
          }
          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const runPromise = runCLI([
            '--service',
            'test-service',
            '--env',
            'prod',
            '--timeout',
            '30',
            '--fail-on-error',
          ])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(1)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
        })

        test('should not fail when gate evaluation result is invalid', async () => {
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest
              .fn()
              .mockResolvedValueOnce(buildGateEvaluationResultResponse('unexpected'))
              .mockResolvedValueOnce(buildGateEvaluationResultResponse('pass')),
          }
          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

          // Run all timers and wait for all pending promises to resolve
          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(0)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(2)
        })

        test('should retry when gate evaluation result returns 404', async () => {
          const mock404Error = Object.assign(new Error('Gate evaluation not found'), {
            isAxiosError: true,
            response: {
              status: 404,
              statusText: 'Not Found',
            },
          })
          const mockApi = {
            requestGateEvaluation: jest.fn().mockResolvedValue(buildEvaluationRequestResponse('test-evaluation-id')),
            getGateEvaluationResult: jest
              .fn()
              .mockRejectedValueOnce(mock404Error)
              .mockResolvedValueOnce(buildGateEvaluationResultResponse('in_progress', ['in_progress', 'in_progress']))
              .mockResolvedValueOnce(buildGateEvaluationResultResponse('pass', ['pass', 'pass'])),
          }
          const apiConstructorSpy = jest.spyOn(apiModule, 'apiConstructor').mockReturnValue(mockApi)

          const runPromise = runCLI(['--service', 'test-service', '--env', 'prod'])

          await jest.runAllTimersAsync()

          const {context, code} = await runPromise

          expect(code).toBe(0)
          expect(context.stdout.toString()).toMatchSnapshot()

          expect(apiConstructorSpy).toHaveBeenCalledWith('https://api.datadoghq.com', 'test-api-key', 'test-app-key')
          expect(mockApi.requestGateEvaluation).toHaveBeenCalledTimes(1)
          expect(mockApi.getGateEvaluationResult).toHaveBeenCalledTimes(3)
          expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(1, 'test-evaluation-id')
          expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(2, 'test-evaluation-id')
          expect(mockApi.getGateEvaluationResult).toHaveBeenNthCalledWith(3, 'test-evaluation-id')
        })
      })
    })
  })

  describe('buildEvaluationRequest', () => {
    test('should build basic request with required parameters', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({service: 'test-service', env: 'prod'})
    })

    test('should include identifier when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'preprod'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'preprod',
      })
    })

    test('should include version when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['version'] = '1.2.3'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        version: '1.2.3',
      })
    })

    test('should include apm_primary_tag when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['apmPrimaryTag'] = 'team:backend'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        apm_primary_tag: 'team:backend',
      })
    })

    test('should include monitors_query_variable when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['monitorsQueryVariable'] = 'test-monitors-query-variable'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        monitors_query_variable: 'test-monitors-query-variable',
      })
    })

    test('should include all optional parameters when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['version'] = '1.2.3'
      command['apmPrimaryTag'] = 'team:backend'
      command['monitorsQueryVariable'] = 'test-monitors-query-variable'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        version: '1.2.3',
        apm_primary_tag: 'team:backend',
        monitors_query_variable: 'test-monitors-query-variable',
      })
    })
  })
})
