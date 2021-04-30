import {DefaultReporter} from '../../reporters/default'
import {RunTestCommand} from '../../run-test'

describe('Default reporter', () => {
  const writeMock = jest.fn()
  const commandMock: unknown = {
    context: {
      stdout: {
        write: writeMock,
      },
    },
  }
  const reporter: any = new DefaultReporter(commandMock as RunTestCommand)
  it('should log for each hook', () => {
    const calls: [string, any[]][] = [
      ['error', ['error']],
      ['initError', [['error']]],
      ['log', ['log']],
      ['runEnd', [{passed: 0, failed: 0, skipped: 0}]],
      ['start', [{startTime: 0}]],
      ['testEnd', [{options: {}}, [], '', []]],
      ['testTrigger', [{}, '', '', {}]],
      ['testWait', [{}]],
    ]
    for (const [fnName, args] of calls) {
      reporter[fnName](...args)
      expect(writeMock).toHaveBeenCalledTimes(1)
      writeMock.mockClear()
    }
  })
})
