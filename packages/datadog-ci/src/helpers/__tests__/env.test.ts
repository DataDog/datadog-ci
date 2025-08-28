import {toBoolean, toNumber, toStringMap} from '../env'

describe('toBoolean', () => {
  const cases: [string | undefined, boolean | undefined][] = [
    ['true', true],
    ['True', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['FALSE', false],
    ['0', false],
    [undefined, undefined],
    ['no', undefined],
    ['yes', undefined],
    ['', undefined],
    ['  ', undefined],
    ['randomString', undefined],
  ]

  test.each(cases)('toBoolean(%s) should return %s', (input, expectedOutput) => {
    expect(toBoolean(input)).toEqual(expectedOutput)
  })
})

describe('toNumber', () => {
  const cases: [string | undefined, number | undefined][] = [
    ['42', 42],
    ['0', 0],
    ['-1', -1],
    ['3.14', 3.14], // Floats should be supported
    ['  42', 42], // Leading whitespace should be ignored
    ['0042', 42], // Leading zeros should be ignored
    ['', undefined],
    ['  ', undefined],
    ['randomString', undefined],
    ['NaN', undefined],
    [undefined, undefined],
  ]

  test.each(cases)('toNumber(%s) should return %s', (input, expectedOutput) => {
    expect(toNumber(input)).toEqual(expectedOutput)
  })
})
describe('toStringMap', () => {
  const cases: [string | undefined, {[key: string]: string} | undefined][] = [
    ['{"key1":"value1","key2":"value2"}', {key1: 'value1', key2: 'value2'}],
    ['{"key1": "value1", "key2": "value2"}', {key1: 'value1', key2: 'value2'}],
    [
      `{
      "key1": "value1",
      "key2": "value2"
    }`,
      {key1: 'value1', key2: 'value2'},
    ], // Multiline JSON should be supported
    ["{'key1': 'value1', 'key2': 'value2'}", {key1: 'value1', key2: 'value2'}], // Single quotes should be supported
    [
      "{'key1': 'value with space 1', 'key2': 'value with space 2'}",
      {key1: 'value with space 1', key2: 'value with space 2'},
    ], // Values with spaces should also be supported
    ['{"key1":"value1"}', {key1: 'value1'}],
    ['{}', {}],
    ['', undefined],
    ['invalid json', undefined],
    ['{"key1": "value1", "key2": 2}', undefined], // Non-string value should result in undefined
    ['null', undefined],
    ['42', undefined],
    [undefined, undefined],
    ['   ', undefined],
    ['{"key1": "value1", "key2": "value2"} extra', undefined], // Extra text should result in undefined
  ]

  test.each(cases)('toStringMap(%s) should return %s', (input, expectedOutput) => {
    expect(toStringMap(input)).toEqual(expectedOutput)
  })
})
