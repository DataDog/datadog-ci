import {BaseContext} from 'clipanion/lib/advanced'

import {ConfigOverride, ExecutionRule, MainReporter, Test} from '../../interfaces'
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

  describe('testTrigger', () => {
    beforeEach(() => {
      writeMock.mockClear()
    })

    const testObject: Pick<Test, 'name'> = {
      name: 'Request on example.org',
    }
    const testId = 'aaa-bbb-ccc'

    const cases: [string, ExecutionRule, ConfigOverride, RegExp][] = [
      [
        'Blocking test, without config overwrite',
        ExecutionRule.BLOCKING,
        {},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\n?$/,
      ],
      [
        'Blocking test, with 1 config override',
        ExecutionRule.BLOCKING,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(1 config override\).*\n?$/,
      ],
      [
        'Blocking test, with 2 config overrides',
        ExecutionRule.BLOCKING,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(2 config overrides\).*\n?$/,
      ],
      [
        'Non-blocking test from Datadog, without config overwrite',
        ExecutionRule.NON_BLOCKING,
        {},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\)\n?$/,
      ],
      [
        'Non-blocking test from Datadog, with 1 config override',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(1 config override\).*\n?$/,
      ],
      [
        'Non-blocking test from Datadog, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(2 config overrides\).*\n?$/,
      ],
      [
        'Non-blocking test, with 1 config override',
        ExecutionRule.NON_BLOCKING,
        {executionRule: ExecutionRule.NON_BLOCKING},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(1 config override\).*\n?$/,
      ],
      [
        'Non-blocking test, with 2 config overrides',
        ExecutionRule.NON_BLOCKING,
        {startUrl: 'foo', executionRule: ExecutionRule.NON_BLOCKING},
        /\[.*aaa-bbb-ccc.*\].*Found test.*Request on example\.org.*\(non-blocking\).*\(2 config overrides\).*\n?$/,
      ],
      [
        'Skipped test, with 1 config override',
        ExecutionRule.SKIPPED,
        {executionRule: ExecutionRule.SKIPPED},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*.*\(1 config override\).*\n?$/,
      ],
      [
        'Skipped test, with 2 config overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', executionRule: ExecutionRule.SKIPPED},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*.*\(2 config overrides\).*\n?$/,
      ],
      [
        'Skipped test from Datadog, without config overwrite',
        ExecutionRule.SKIPPED,
        {},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog\n?$/,
      ],
      [
        'Skipped test from Datadog, with 1 config override',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo'},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog.*\(1 config override\).*\n?$/,
      ],
      [
        'Skipped test from Datadog, with 2 config overrides',
        ExecutionRule.SKIPPED,
        {startUrl: 'foo', body: 'hello'},
        /\[.*aaa-bbb-ccc.*\].*Skipped test.*Request on example\.org.*because of execution rule configuration in Datadog.*\(2 config overrides\).*\n?$/,
      ],
    ]

    test.each(cases)('%s', (title, executionRule, config, expectedOutputPattern) => {
      reporter.testTrigger(testObject, testId, executionRule, config)
      expect(writeMock.mock.calls[0][0]).toMatch(expectedOutputPattern)
    })
  })
})
