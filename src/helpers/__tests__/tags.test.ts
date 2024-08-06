import {SpanTags} from '../interfaces'
import {parseTags, parseMetrics, getSpanTags} from '../tags'

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
    expect(parseMetrics(['key1:123', 'key2:321', 'key3:321.1', 'key4:-123.1'])).toEqual({
      key1: 123,
      key2: 321,
      key3: 321.1,
      key4: -123.1,
    })
  })
  test('should not include invalid key:value pairs', () => {
    expect(parseMetrics(['key1:123', 'key2:321', 'invalidkeyvalue', 'key3:a'])).toEqual({key1: 123, key2: 321})
  })
})

describe('getSpanTags', () => {
  test('should parse DD_TAGS and DD_ENV environment variables', async () => {
    process.env.DD_TAGS = 'key1:https://google.com,key2:value2'
    process.env.DD_ENV = 'ci'

    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: process.env.DD_ENV,
        envVarTags: process.env.DD_TAGS,
      },
      undefined,
      true
    )
    expect(spanTags).toMatchObject({
      env: 'ci',
      key1: 'https://google.com',
      key2: 'value2',
    })
  })
  test('should parse tags argument', async () => {
    const spanTags: SpanTags = await getSpanTags(
      {
        apiKey: undefined,
        env: undefined,
        envVarTags: undefined,
      },
      ['key1:value1', 'key2:value2'],
      true
    )
    expect(spanTags).toMatchObject({
      key1: 'value1',
      key2: 'value2',
    })
  })
})
