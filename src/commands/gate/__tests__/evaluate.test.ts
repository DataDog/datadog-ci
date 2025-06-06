import fs from 'fs'

import type {AxiosResponse, InternalAxiosRequestConfig} from 'axios'

import {createCommand} from '../../../helpers/__tests__/testing-tools'

import {apiConstructor} from '../api'
import {GateEvaluateCommand} from '../evaluate'
import {EvaluationResponse, EvaluationResponsePayload, Payload} from '../interfaces'

describe('evaluate', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })

    test('should throw an error if App key is undefined', () => {
      process.env = {DD_API_KEY: 'PLACEHOLDER'}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      expect(command['getApiHelper'].bind(command)).toThrow('App key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_APP_KEY')
    })
  })
  describe('handleEvaluationSuccess', () => {
    test('should fail the command if gate evaluation failed', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'failed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(1)
    })

    test('should pass the command if gate evaluation passed', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
    })

    test('should render the rule URL and rule name', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [ruleEvaluation],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain(
        'Rule URL: https://app.datadoghq.com/ci/quality-gates/rule/943d0eb8-907e-48cf-8178-3498900fe493'
      )
      expect(write.mock.calls[0][0]).toContain('Rule Name: No new flaky tests')
    })

    test('should render the rule URL for datad0g', () => {
      process.env = {DD_SITE: 'datad0g.com', DD_SUBDOMAIN: 'dd'}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [ruleEvaluation],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain(
        'Rule URL: https://dd.datad0g.com/ci/quality-gates/rule/943d0eb8-907e-48cf-8178-3498900fe493'
      )
    })

    test('should render the rule URL for ap1.datadoghq.com', () => {
      process.env = {DD_SITE: 'ap1.datadoghq.com'}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [ruleEvaluation],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain(
        'Rule URL: https://ap1.datadoghq.com/ci/quality-gates/rule/943d0eb8-907e-48cf-8178-3498900fe493'
      )
    })

    test('should render the rule URL for ap2.datadoghq.com', () => {
      process.env = {DD_SITE: 'ap2.datadoghq.com'}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [ruleEvaluation],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain(
        'Rule URL: https://ap2.datadoghq.com/ci/quality-gates/rule/943d0eb8-907e-48cf-8178-3498900fe493'
      )
    })

    test('should pass the command on empty evaluation status by default', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'empty',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain('No matching rules were found in Datadog')
    })

    test('should fail the command on empty result if the override option is provided', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})
      command['failOnEmpty'] = true

      const response: EvaluationResponse = {
        status: 'empty',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(1)
      expect(write.mock.calls[0][0]).toContain('No matching rules were found in Datadog')
    })

    test('should pass the command on dry run evaluation status', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}})

      const response: EvaluationResponse = {
        status: 'dry_run',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain('Successfully completed a dry run request')
    })
  })
  describe('handleEvaluationError', () => {
    test('should fail the command if the error is 4xx', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})

      const error = createError(400, 'validation failure')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(1)

      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. Status code: 400.')
      expect(stdErrLog).toContain('Error is "validation failure"')
    })

    test('should fail the command if the error is 5xx and fail-if-unavailable option is enabled', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['failIfUnavailable'] = true

      const error = createError(500, 'internal issue')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(1)

      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. Status code: 500')
      expect(stdErrLog).not.toContain('--fail-if-unavailable')
      expect(stdErrLog).not.toContain('internal issue')
    })

    test('should pass the command if the error is 5xx and fail-if-unavailable option is not enabled', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})

      const error = createError(500, 'internal issue')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(0)

      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. Status code: 500')
      expect(stdErrLog).toContain("Use the '--fail-if-unavailable' option to fail the command in this situation.")
      expect(stdErrLog).not.toContain('internal issue')
    })

    test('should pass the command if the error is timeout and fail-if-unavailable option is not enabled', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})

      const error = new Error('wait')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(0)
      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. The command timed out.')
    })

    test('should fail the command if the error is timeout and fail-if-unavailable option is enabled', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['failIfUnavailable'] = true

      const error = new Error('wait')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(1)
      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. The command timed out.')
    })
  })
  describe('evaluateRules', () => {
    process.env = {DD_API_KEY: 'PLACEHOLDER', DD_APP_KEY: 'PLACEHOLDER'}
    const api = apiConstructor('', '', '')
    const mockRequest = (): Payload => {
      return {
        requestId: '123',
        startTimeMs: new Date().getTime(),
        spanTags: {},
        userScope: {},
        options: {
          dryRun: false,
          noWait: false,
        },
      }
    }
    const waitMockResponse = (waitTime: number): AxiosResponse<EvaluationResponsePayload> => {
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
        data: {
          data: {
            attributes: {
              status: 'wait',
              rule_evaluations: [],
              metadata: {
                wait_time_ms: waitTime,
              },
            },
          },
        },
      }
    }
    const passedMockResponse: AxiosResponse<EvaluationResponsePayload> = {
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
      data: {
        data: {
          attributes: {
            status: 'passed',
            rule_evaluations: [],
          },
        },
      },
    }

    test('should pass the command after waiting if the status is passed on the retry', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})

      jest
        .spyOn(api, 'evaluateGateRules')
        .mockResolvedValueOnce(waitMockResponse(1))
        .mockResolvedValueOnce(passedMockResponse)

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          // should not send isLastRetry if it's not the last retry or a timeout
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(2)
          expectNoLastRetry(api, 2)
          expect(response).toBe(0)
        })
    })

    test('should pass the command after exhausting all retries and fail-if-unavailable option is not enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})

      jest.spyOn(api, 'evaluateGateRules').mockResolvedValue(waitMockResponse(1))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(6)
          expectNoLastRetry(api, 5)
          // should send isLastRetry if it's the last retry
          expectLastRetry(api)
          expect(response).toBe(0)
        })
    })

    test('should fail the command after exhausting all retries and fail-if-unavailable option is enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['failIfUnavailable'] = true

      jest.spyOn(api, 'evaluateGateRules').mockResolvedValue(waitMockResponse(1))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(6)
          expectNoLastRetry(api, 5)
          // should send isLastRetry if it's the last retry
          expectLastRetry(api)
          expect(response).toBe(1)
        })
    })

    test('should pass the command if the timeout is 0 and fail-if-unavailable option is not enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['timeoutInSeconds'] = 0
      jest.spyOn(api, 'evaluateGateRules').mockResolvedValueOnce(waitMockResponse(1))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(1)
          // should send isLastRetry if it's timeout
          expectLastRetry(api)
          expect(response).toBe(0)
        })
    })

    test('should fail the command if the timeout is 0 and fail-if-unavailable option is enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['timeoutInSeconds'] = 0
      command['failIfUnavailable'] = true
      jest.spyOn(api, 'evaluateGateRules').mockResolvedValueOnce(waitMockResponse(1))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(1)
          // should send isLastRetry if it's timeout
          expectLastRetry(api)
          expect(response).toBe(1)
        })
    })

    test('should pass the command if wait time is greater than the timeout and fail-if-unavailable option is not enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['timeoutInSeconds'] = 1
      jest.spyOn(api, 'evaluateGateRules').mockResolvedValueOnce(waitMockResponse(1100))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(2)
          expectNoLastRetry(api, 1)
          // should send isLastRetry if it's timeout
          expectLastRetry(api)
          expect(response).toBe(0)
        })
    })

    test('should fail the command if wait time is greater than the timeout and fail-if-unavailable option is enabled', async () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['timeoutInSeconds'] = 1
      command['failIfUnavailable'] = true
      jest.spyOn(api, 'evaluateGateRules').mockResolvedValueOnce(waitMockResponse(1100))

      return command['evaluateRules']
        .bind(command)
        .call({}, api, mockRequest())
        .then((response) => {
          expect(api.evaluateGateRules).toHaveBeenCalledTimes(2)
          expectNoLastRetry(api, 1)
          // should send isLastRetry if it's timeout
          expectLastRetry(api)
          expect(response).toBe(1)
        })
    })

    test('should include head SHA if it is a pull_request or pull_request_target event', async () => {
      const HEAD_SHA = '1234567'
      const fakeWebhookPayloadPath = './event.json'
      const oldEnvGitHubActions = process.env.GITHUB_ACTIONS
      const oldEnvGitHubEventPath = process.env.GITHUB_EVENT_PATH
      const oldEnvGitHubBaseRef = process.env.GITHUB_BASE_REF
      process.env.GITHUB_ACTIONS = '1'
      process.env.GITHUB_EVENT_PATH = fakeWebhookPayloadPath
      process.env.GITHUB_BASE_REF = 'main' // only set in pull_request and pull_request_target events

      fs.writeFileSync(
        fakeWebhookPayloadPath,
        JSON.stringify({
          pull_request: {
            head: {
              sha: HEAD_SHA,
            },
          },
        })
      )

      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}})
      command['timeoutInSeconds'] = 1
      command['failIfUnavailable'] = true
      command['getApiHelper'] = jest.fn().mockReturnValue(api)
      jest.spyOn(api, 'evaluateGateRules').mockResolvedValueOnce(waitMockResponse(100))

      await command.execute()
      expect((api.evaluateGateRules as jest.Mock).mock.calls[0][0].options.pull_request_sha).toEqual(HEAD_SHA)

      process.env.GITHUB_ACTIONS = oldEnvGitHubActions
      process.env.GITHUB_EVENT_PATH = oldEnvGitHubEventPath
      process.env.GITHUB_BASE_REF = oldEnvGitHubBaseRef
      fs.unlinkSync(fakeWebhookPayloadPath)
    })
  })
})

const ruleEvaluation = {
  rule_id: '943d0eb8-907e-48cf-8178-3498900fe493',
  rule_name: 'No new flaky tests',
  status: 'Passed',
  is_blocking: true,
  failure_reason: '',
  details_url: '',
}

const createError = (statusCode: number, message: string): unknown => {
  return {
    response: {
      status: statusCode,
      data: {
        errors: [
          {
            detail: message,
          },
        ],
      },
    },
  }
}

const expectNoLastRetry = (api: any, attempts: number): void => {
  for (let i = 0; i < attempts; i++) {
    expect(api.evaluateGateRules).toHaveBeenNthCalledWith(
      i + 1,
      expect.objectContaining({
        options: expect.not.objectContaining({
          isLastRetry: true,
        }),
      }),
      expect.anything()
    )
  }
}

const expectLastRetry = (api: any): void => {
  expect(api.evaluateGateRules).toHaveBeenLastCalledWith(
    expect.objectContaining({
      options: expect.objectContaining({
        isLastRetry: true,
      }),
    }),
    expect.anything()
  )
}
