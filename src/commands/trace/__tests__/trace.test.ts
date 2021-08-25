// tslint:disable: no-string-literal no-null-keyword
import {TraceCommand} from '../trace'

describe('trace', () => {
  describe('signalToNumber', () => {
    test('should map undefined to undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = new TraceCommand()
      command.context = {stdout: {write}} as any

      expect(command['signalToNumber'].call(undefined, null)).toBeUndefined()
    })
    test('should map SIGKILL to 137', () => {
      process.env = {}
      const write = jest.fn()
      const command = new TraceCommand()
      command.context = {stdout: {write}} as any

      expect(command['signalToNumber'].call(undefined, 'SIGKILL')).toEqual(137)
    })
  })

  describe('getData', () => {
    test('should throw if no CI is detected', () => {
      process.env = {}
      const write = jest.fn()
      const command = new TraceCommand()
      command.context = {stdout: {write}} as any

      expect(command['getData'].bind(command)).toThrow(
        'Cannot detect any CI Provider. This command only works if run as part of your CI.'
      )
    })

    test('should correctly detect the circleci environment', () => {
      process.env = {
        CIRCLECI: 'true',
        CIRCLE_WORKFLOW_ID: 'test',
        NON_CIRCLE_ENV: 'bar',
      }
      const write = jest.fn()
      const command = new TraceCommand()
      command.context = {stdout: {write}} as any

      expect(command['getData']()).toEqual([
        'circleci',
        {
          CIRCLE_WORKFLOW_ID: 'test',
        },
      ])
    })
  })
})
