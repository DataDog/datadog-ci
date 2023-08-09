import {createCommand} from '../../../helpers/__tests__/fixtures'

import {GateEvaluateCommand} from '../evaluate'
import {EvaluationResponse} from '../interfaces'

describe('evaluate', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
    test('should throw an error if APP key is undefined', () => {
      process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

      expect(command['getApiHelper'].bind(command)).toThrow('APP key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_APP_KEY')
    })
  })
  describe('handleEvaluationSuccess', () => {
    test('should fail the command if gate evaluation failed', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

      const response: EvaluationResponse = {
        status: 'failed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(1)
    })
    test('should pass the command if gate evaluation passed', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
    })
    test('should pass the command on empty evaluation status by default', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

      const response: EvaluationResponse = {
        status: 'empty',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain('No matching rules were found in Datadog')
    })
    test('should fail the command on empty result if the override option is provided', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)
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
      const command = createCommand(GateEvaluateCommand, {stdout: {write}} as any)

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
      const command = createCommand(GateEvaluateCommand, {stderr: {write}} as any)

      const error = createError(400, 'validation failure')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(1)

      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. Status code: 400.')
      expect(stdErrLog).toContain('Error is "validation failure"')
    })
    test('should fail the command if the error is 5xx and fail-if-unavailable option is enabled', () => {
      const write = jest.fn()
      const command = createCommand(GateEvaluateCommand, {stderr: {write}} as any)
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
      const command = createCommand(GateEvaluateCommand, {stderr: {write}} as any)

      const error = createError(500, 'internal issue')
      expect(command['handleEvaluationError'].bind(command).call({}, error)).toEqual(0)

      const stdErrLog = write.mock.calls[0][0]
      expect(stdErrLog).toContain('ERROR: Could not evaluate the rules. Status code: 500')
      expect(stdErrLog).toContain("Use the '--fail-if-unavailable' option to fail the command in this situation.")
      expect(stdErrLog).not.toContain('internal issue')
    })
  })
  describe('wait', () => {
    test('should pass the command if the response status is wait', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      const response: EvaluationResponse = {
        status: 'wait',
        rule_evaluations: [],
        metadata: {
          wait_time_ms: 10,
        },
      }
      expect(command['handleEvaluationSuccess'].bind(command).call({}, response)).toEqual(0)
    })
  })
})

const createError = (statusCode: number, message: string): any => {
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
