import {ExecutionRule, ResultInBatch} from '../../interfaces'
import {
  getOverriddenExecutionRule,
  hasResultPassed,
  parseOverrideValue,
  toExecutionRule,
  validateAndParseOverrides,
} from '../../utils/internal'

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
          getOverriddenExecutionRule(
            testRule ? {...test, options: {...test.options, ci: {executionRule: testRule}}} : test,
            resultRule ? {executionRule: resultRule} : {}
          )
        ).toEqual(expectedRule)
      }
    )
  })

  describe('hasResultPassed', () => {
    test('result', () => {
      const result = {status: 'passed'} as ResultInBatch
      expect(hasResultPassed(result, false, false, {failOnCriticalErrors: false, failOnTimeout: true})).toBe(true)
      expect(hasResultPassed(result, false, false, {failOnCriticalErrors: true, failOnTimeout: true})).toBe(true)
      result.status = 'failed'
      expect(hasResultPassed(result, false, false, {failOnCriticalErrors: false, failOnTimeout: true})).toBe(false)
      expect(hasResultPassed(result, false, false, {failOnCriticalErrors: true, failOnTimeout: true})).toBe(false)
    })

    test('unhealthy result', () => {
      const result = {} as ResultInBatch
      const isUnhealthy = true // comes from the server result
      expect(hasResultPassed(result, isUnhealthy, false, {failOnCriticalErrors: false, failOnTimeout: true})).toBe(true)
      expect(hasResultPassed(result, isUnhealthy, false, {failOnCriticalErrors: true, failOnTimeout: true})).toBe(false)
    })

    test('timed out result', () => {
      const result = {} as ResultInBatch
      const hasTimedOut = true // batch timed out or safe deadline
      expect(hasResultPassed(result, false, hasTimedOut, {failOnCriticalErrors: true, failOnTimeout: true})).toBe(false)
      expect(hasResultPassed(result, false, hasTimedOut, {failOnCriticalErrors: true, failOnTimeout: false})).toBe(true)
    })

    test('in-progress result', () => {
      const result = {status: 'in_progress'} as ResultInBatch // failed non-final result (retry expected)
      expect(hasResultPassed(result, false, false, {failOnCriticalErrors: true, failOnTimeout: true})).toBe(false)
    })
  })

  describe('toExecutionRule', () => {
    const cases: [string | undefined, ExecutionRule | undefined][] = [
      ['blocking', ExecutionRule.BLOCKING],
      ['non_blocking', ExecutionRule.NON_BLOCKING],
      ['skipped', ExecutionRule.SKIPPED],
      ['BLOCKING', ExecutionRule.BLOCKING], // Case-sensitive check
      ['NON_BLOCKING', ExecutionRule.NON_BLOCKING],
      ['non-blocking', undefined], // Exact match required
      ['', undefined],
      ['  ', undefined],
      ['randomString', undefined],
      [undefined, undefined],
    ]
    test.each(cases)('toExecutionRule(%s) should return %s', (input, expectedOutput) => {
      expect(toExecutionRule(input)).toEqual(expectedOutput)
    })
  })

  describe('overrideUtils', () => {
    describe('parseValue', () => {
      it('should parse boolean values correctly', () => {
        expect(parseOverrideValue('true', 'boolean')).toBe(true)
        expect(parseOverrideValue('True', 'boolean')).toBe(true)
        expect(parseOverrideValue('TRUE', 'boolean')).toBe(true)
        expect(parseOverrideValue('1', 'boolean')).toBe(true)
        expect(parseOverrideValue('false', 'boolean')).toBe(false)
        expect(parseOverrideValue('False', 'boolean')).toBe(false)
        expect(parseOverrideValue('FALSE', 'boolean')).toBe(false)
        expect(parseOverrideValue('0', 'boolean')).toBe(false)
      })

      it('should throw an error for invalid boolean values', () => {
        expect(() => parseOverrideValue('notABoolean', 'boolean')).toThrow('Invalid boolean value: notABoolean')
        expect(() => parseOverrideValue('', 'boolean')).toThrow('Invalid boolean value: ')
      })

      it('should parse number values correctly', () => {
        expect(parseOverrideValue('123', 'number')).toBe(123)
        expect(parseOverrideValue('3.14', 'number')).toBe(3.14)
      })

      it('should throw an error for invalid number values', () => {
        expect(() => parseOverrideValue('notANumber', 'number')).toThrow('Invalid number value: notANumber')
      })

      it('should parse string values correctly', () => {
        expect(parseOverrideValue('  hello world!  ', 'string')).toBe('hello world!')
        expect(parseOverrideValue('\\,./!@#$%^&*()_-+=|/?<>[]{}\\', 'string')).toBe('\\,./!@#$%^&*()_-+=|/?<>[]{}\\')
      })

      it('should parse enum values correctly', () => {
        expect(parseOverrideValue('blocking', 'ExecutionRule')).toBe(ExecutionRule.BLOCKING)
        expect(parseOverrideValue('non_blocking', 'ExecutionRule')).toBe(ExecutionRule.NON_BLOCKING)
        expect(parseOverrideValue('skipped', 'ExecutionRule')).toBe(ExecutionRule.SKIPPED)
      })
      it('should throw an error for invalid enum values', () => {
        expect(() => parseOverrideValue('invalid_enum', 'ExecutionRule')).toThrow(
          'Invalid ExecutionRule value: invalid_enum'
        )
      })
      it('should parse string array values correctly', () => {
        expect(parseOverrideValue(' first value;second value ; \\,./!@#$%^&*()_-+=|/?<>[]{}\\  ', 'string[]')).toEqual([
          'first value',
          'second value',
          '\\,./!@#$%^&*()_-+=|/?<>[]{}\\',
        ])
      })
    })

    describe('validateAndParseOverrides', () => {
      it('should parse valid overrides correctly', () => {
        const overrides = [
          'allowInsecureCertificates=true',
          'body=a body with spaces',
          'defaultStepTimeout=300',
          'followRedirects=False',
          'resourceUrlSubstitutionRegexes=s/(https://www.)(.*)/$1extra-$2;https://example.com(.*)|http://subdomain.example.com$1',
        ]
        const parsedOverrides = validateAndParseOverrides(overrides)

        expect(parsedOverrides).toEqual({
          allowInsecureCertificates: true,
          body: 'a body with spaces',
          defaultStepTimeout: 300,
          followRedirects: false,
          resourceUrlSubstitutionRegexes: [
            's/(https://www.)(.*)/$1extra-$2',
            'https://example.com(.*)|http://subdomain.example.com$1',
          ],
        })
      })

      it('should throw an error for invalid keys', () => {
        const overrides = ['invalidKey=value']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: invalidKey')
      })

      it('should throw an error for invalid values', () => {
        const overrides = ['defaultStepTimeout=notANumber']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid number value: notANumber')
      })

      it('should suggest correction for invalid case of valid keys', () => {
        let overrides = ['startURL=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: startURL. Did you mean `startUrl`?')

        // resourceUrlSubstitutionRegexe is missing the plural "s"
        overrides = ['resourceUrlSubstitutionRegexe=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow(
          'Invalid key: resourceUrlSubstitutionRegexe. Did you mean `resourceUrlSubstitutionRegexes`?'
        )

        overrides = ['startUrlSubstitution=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow(
          'Invalid key: startUrlSubstitution. Did you mean `startUrlSubstitutionRegex`?'
        )

        overrides = ['startUrlS=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: startUrlS. Did you mean `startUrl`?')

        overrides = ['startUrlSub=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: startUrlSub. Did you mean `startUrl`?')

        // Levenshtein distance > 5 should not suggest a correction
        overrides = ['startUrlSubsti=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: startUrlSubsti')

        // resourceUrlSubstitutionRegexes or startUrlSubstitutionRegexes: we can't make a suggestion
        overrides = ['UrlSubstitutionRegexes=blah']
        expect(() => validateAndParseOverrides(overrides)).toThrow('Invalid key: UrlSubstitutionRegexes')
      })
    })
  })
})
