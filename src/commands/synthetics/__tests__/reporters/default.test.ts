import {BaseContext} from 'clipanion/lib/advanced'
import {DefaultReporter} from '../../reporters/default'

describe('Default reporter', () => {
  const writeMock = jest.fn()
  const mockContext: unknown = {
    context : {
      stdout: {
        write: writeMock,
      },
    }
  }
  const reporter: any = new DefaultReporter(mockContext as {context: BaseContext})
  it('should log for each hook', () => {
    const calls: [string, any[]][] = [
      ['error', ['error']],
      ['initError', [['error']]],
      ['log', ['log']],
      ['reportStart', [{startTime: 0}]],
      ['runEnd', [{passed: 0, failed: 0, skipped: 0}]],
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
