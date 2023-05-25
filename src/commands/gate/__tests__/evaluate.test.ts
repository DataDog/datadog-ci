import {CI_PIPELINE_NAME, GIT_BRANCH, GIT_REPOSITORY_URL} from '../../../helpers/tags'

import {GateEvaluateCommand} from '../evaluate'
import {EvaluationResponse} from '../interfaces'

describe('evaluate', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
    test('should throw an error if APP key is undefined', () => {
      process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('APP key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_APP_KEY')
    })
  })
  describe('handleEvaluationResponse', () => {
    test('should fail the command if gate evaluation failed', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      const response: EvaluationResponse = {
        status: 'failed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationResponse'].bind(command).call({}, response)).toEqual(1)
    })
    test('should pass the command if gate evaluation passed', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      const response: EvaluationResponse = {
        status: 'passed',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationResponse'].bind(command).call({}, response)).toEqual(0)
    })
    test('should pass the command on empty evaluation status by default', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stdout: {write}} as any

      const response: EvaluationResponse = {
        status: 'empty',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationResponse'].bind(command).call({}, response)).toEqual(0)
      expect(write.mock.calls[0][0]).toContain('No matching rules were found in Datadog')
    })
    test('should fail the command on empty result if the override option is provided', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command['failOnEmpty'] = true
      command.context = {stdout: {write}} as any

      const response: EvaluationResponse = {
        status: 'empty',
        rule_evaluations: [],
      }
      expect(command['handleEvaluationResponse'].bind(command).call({}, response)).toEqual(1)
      expect(write.mock.calls[0][0]).toContain('No matching rules were found in Datadog')
    })
  })
  describe('hasRequiredTags', () => {
    test('should return true if all required tags are present', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stderr: {write}} as any
      const spanTags = {
        [CI_PIPELINE_NAME]: 'pipeline name',
        [GIT_REPOSITORY_URL]: 'repo_URL',
        [GIT_BRANCH]: 'branch',
      }

      expect(command['hasRequiredTags'].bind(command).call({}, spanTags)).toEqual(true)
    })
    test('should return false if repository is missing', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stderr: {write}} as any
      const spanTags = {
        [CI_PIPELINE_NAME]: 'pipeline name',
        [GIT_BRANCH]: 'branch',
      }

      expect(command['hasRequiredTags'].bind(command).call({}, spanTags)).toEqual(false)
      expect(write.mock.calls[0][0]).toContain(
        'ERROR: the following information could not be retrieved: "Repository URL"'
      )
    })
    test('should return false if branch is missing', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stderr: {write}} as any
      const spanTags = {
        [CI_PIPELINE_NAME]: 'pipeline name',
        [GIT_REPOSITORY_URL]: 'repo_URL',
      }

      expect(command['hasRequiredTags'].bind(command).call({}, spanTags)).toEqual(false)
      expect(write.mock.calls[0][0]).toContain('ERROR: the following information could not be retrieved: "Branch Name"')
    })
    test('should return false if pipeline name is missing', () => {
      const write = jest.fn()
      const command = new GateEvaluateCommand()
      command.context = {stderr: {write}} as any
      const spanTags = {
        [GIT_REPOSITORY_URL]: 'repo_URL',
        [GIT_BRANCH]: 'branch',
      }

      expect(command['hasRequiredTags'].bind(command).call({}, spanTags)).toEqual(false)
      expect(write.mock.calls[0][0]).toContain(
        'ERROR: the following information could not be retrieved: "Pipeline Name"'
      )
    })
  })
})
