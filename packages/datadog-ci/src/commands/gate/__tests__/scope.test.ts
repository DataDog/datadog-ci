import {parseScope} from '../utils'

describe('parseScope', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseScope([''])).toEqual({})
    expect(parseScope(['not.correct.format'])).toEqual({})
    expect(parseScope(['not.correct.format,either'])).toEqual({})
  })

  test('returns an object with the scope variables with well formatted strings', () => {
    expect(parseScope(['key1:value1', 'key2:value2'])).toEqual({key1: ['value1'], key2: ['value2']})
  })

  test('should not include invalid key:value pairs', () => {
    expect(parseScope(['key1:value1', 'key2:value2', 'invalidkeyvalue'])).toEqual({key1: ['value1'], key2: ['value2']})
  })

  test('should merge values for the same key', () => {
    expect(parseScope(['key1:value1', 'team:backend', 'team:frontend'])).toEqual({
      key1: ['value1'],
      team: ['backend', 'frontend'],
    })
  })

  test('should remove duplicated values', () => {
    expect(parseScope(['key1:value1', 'team:backend', 'team:backend'])).toEqual({
      key1: ['value1'],
      team: ['backend'],
    })
  })
})
