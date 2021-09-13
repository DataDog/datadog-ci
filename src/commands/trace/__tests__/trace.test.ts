// tslint:disable: no-string-literal no-null-keyword
import {TraceCommand} from '../trace'

describe('trace', () => {
  describe('signalToNumber', () => {
    test('should map null to undefined', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber'](null)).toBeUndefined()
    })
    test('should map SIGKILL to 137', () => {
      const command = new TraceCommand()
      expect(command['signalToNumber']('SIGKILL')).toEqual(128 + 9)
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

    test('should correctly detect the github environment', () => {
      process.env = {
        GITHUB_ACTIONS: 'true',
        GITHUB_RUN_ID: '123456789',
        NON_CIRCLE_ENV: 'bar',
      }
      const command = new TraceCommand()
      expect(command['getCIEnvVars']()).toEqual([
        {
          GITHUB_RUN_ID: '123456789',
        },
        'github',
      ])
    })
  })
})
