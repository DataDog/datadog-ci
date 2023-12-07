import {ExecutionRule} from '../../interfaces'
import * as internalUtils from '../../utils/internal'

import {getApiTest} from '../fixtures'

describe('utils', () => {
  describe('getOverriddenExecutionRule', () => {
    const cases: [ExecutionRule | undefined, ExecutionRule | undefined, ExecutionRule | undefined][] = [
      [undefined, undefined, undefined],
      [undefined, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [undefined, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.BLOCKING, undefined, undefined],
      [ExecutionRule.BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.BLOCKING],
      [ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, undefined, undefined],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.BLOCKING, ExecutionRule.NON_BLOCKING],
      [ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING, ExecutionRule.NON_BLOCKING],
    ]

    test.each(cases)(
      'execution rule: %s, result execution rule: %s. Expected rule: %s',
      (testRule, resultRule, expectedRule) => {
        const test = getApiTest('abc-def-ghi')

        expect(
          internalUtils.getOverriddenExecutionRule(
            testRule ? {...test, options: {...test.options, ci: {executionRule: testRule}}} : test,
            resultRule ? {executionRule: resultRule} : {}
          )
        ).toEqual(expectedRule)
      }
    )
  })
})
