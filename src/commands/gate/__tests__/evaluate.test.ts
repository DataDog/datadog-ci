import {GateEvaluateCommand} from '../evaluate'

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
  // TODO add tests for the call to evaluate rules
})
