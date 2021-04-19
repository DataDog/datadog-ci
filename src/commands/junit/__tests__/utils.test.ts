import {parseTags} from '../utils'

describe('parseTags', () => {
  test('falls back to empty object if invalid format', () => {
    expect(parseTags(undefined)).toEqual({})
    expect(parseTags('')).toEqual({})
    expect(parseTags('not.correct.format')).toEqual({})
    expect(parseTags('not.correct.format,either')).toEqual({})
  })
  test('returns an object with the tags', () => {
    expect(parseTags('key1:value1,key2:value2')).toEqual({key1: 'value1', key2: 'value2'})
  })
})
