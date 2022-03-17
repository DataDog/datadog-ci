import {BaseContext} from 'clipanion/lib/advanced'

import {MainReporter} from '../../interfaces'
import {DefaultReporter} from '../../reporters/default'
import {createSummary} from '../../utils'

describe('Default reporter', () => {
  const writeMock = jest.fn()
  const mockContext: unknown = {
    context: {
      stdout: {
        write: writeMock,
      },
    },
  }
  const reporter: any = new DefaultReporter(mockContext as {context: BaseContext})
  it('should log for each hook', () => {
    // `testWait` is skipped as nothing is logged for the default reporter.
    const calls: [keyof MainReporter, any[]][] = [
      ['error', ['error']],
      ['initErrors', [['error']]],
      ['log', ['log']],
      ['reportStart', [{startTime: 0}]],
      ['runEnd', [createSummary()]],
      ['testEnd', [{options: {}}, [], '', []]],
      ['testTrigger', [{}, '', '', {}]],
      ['testsWait', [[{}]]],
    ]
    for (const [fnName, args] of calls) {
      reporter[fnName](...args)
      expect(writeMock).toHaveBeenCalledTimes(1)
      writeMock.mockClear()
    }
  })
})
