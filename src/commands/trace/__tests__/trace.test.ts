/* eslint-disable no-null/no-null */
import {createCommand} from '../../../helpers/__tests__/fixtures'

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
      const command = createCommand(TraceCommand)
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

    test('should correctly detect the jenkins environment', () => {
      process.env = {
        DD_CUSTOM_TRACE_ID: 'abc',
        JENKINS_HOME: '/root',
        NON_JENKINS_ENV: 'bar',
        WORKSPACE: 'def',
      }
      const command = new TraceCommand()
      expect(command['getCIEnvVars']()).toEqual([
        {
          DD_CUSTOM_TRACE_ID: 'abc',
          WORKSPACE: 'def',
        },
        'jenkins',
      ])
    })

    test('should not detect the jenkins environment if it is not instrumented', () => {
      process.env = {
        // DD_CUSTOM_TRACE_ID not defined to simulate a non-instrumented instance
        JENKINS_HOME: '/root',
        NON_JENKINS_ENV: 'bar',
        WORKSPACE: 'def',
      }
      const command = new TraceCommand()
      expect(command['getCIEnvVars'].call({context: {stdout: {write: () => undefined}}})).toEqual([{}])
    })
  })
})
