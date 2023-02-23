import {parseTags, parseMetrics} from '../tags'

describe('parseTags', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseTags([''])).toEqual({})
    expect(parseTags(['not.correct.format'])).toEqual({})
    expect(parseTags(['not.correct.format,either'])).toEqual({})
  })
  test('returns an object with the tags with well formatted strings', () => {
    expect(parseTags(['key1:value1', 'key2:value2'])).toEqual({key1: 'value1', key2: 'value2'})
  })
  test('should not include invalid key:value pairs', () => {
    expect(parseTags(['key1:value1', 'key2:value2', 'invalidkeyvalue'])).toEqual({key1: 'value1', key2: 'value2'})
  })
})

describe('parseMetrics', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseMetrics([''])).toEqual({})
    expect(parseMetrics(['not.correct.format'])).toEqual({})
    expect(parseMetrics(['not.correct.format,either'])).toEqual({})
  })
  test('returns an object with the tags with well formatted numbers', () => {
    expect(parseMetrics(['key1:123', 'key2:321'])).toEqual({key1: 123, key2: 321})
  })
  test('should not include invalid key:value pairs', () => {
    expect(parseMetrics(['key1:123', 'key2:321', 'invalidkeyvalue', 'key3:a'])).toEqual({key1: 123, key2: 321})
  })
})
