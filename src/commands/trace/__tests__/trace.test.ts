// tslint:disable: no-string-literal no-null-keyword
import {TraceCommand} from '../trace'

describe('trace', () => {
  describe('signalToNumber', () => {
    test('should map undefined to undefined', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber'](null)).toBeUndefined()
    })
    test('should map SIGKILL to 137', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber']('SIGKILL')).toEqual(137)
    })
  })

  describe('getCIEnvVars', () => {
    test('should throw if no CI is detected', () => {
      process.env = {}
      const command = new TraceCommand()
      expect(command['getCIEnvVars'].bind(command)).toThrow(
        /Cannot detect any supported CI Provider\. This command only works if run as part of your CI\..*/
      )
    })

    test('should correctly detect the circleci environment', () => {
      process.env = {
        CIRCLECI: 'true',
        CIRCLE_WORKFLOW_ID: 'test',
        NON_CIRCLE_ENV: 'bar',
      }
      const command = new TraceCommand()
      expect(command['getCIEnvVars']()).toEqual([
        {
          CIRCLE_WORKFLOW_ID: 'test',
        },
        'circleci',
      ])
    })
  })
})
