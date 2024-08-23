import {BaseContext} from 'clipanion'

import {SpanTags} from '../interfaces'
import {parseTags, parseMetrics, getSpanTags, parseTagsFile, parseMeasuresFile} from '../tags'

const fixturesPath = './src/helpers/__tests__/tags-fixtures'
const createMockContext = (): BaseContext => {
  let out = ''
  let err = ''

  return {
    stderr: {
      toString: () => err,
      write: (input: string) => {
        err += input

        return true
      },
    },
    stdout: {
      toString: () => out,
      write: (input: string) => {
        out += input

        return true
      },
    },
  } as BaseContext
}

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

describe('parseTagsFile', () => {
  test('valid', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-valid.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({foo: 'hello', bar: 'world'})
  })
  test('valid but ignores data', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-mixed.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({
      tag1: 'value1',
      metric_mistake: '123',
      my_boolean: 'true',
      tag4: 'value4',
    })
    expect(context.stdout.toString()).toContain("[WARN] tag 'metric_mistake' was not a string, converting to string")
  })
  test('nested fields should be removed', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, `${fixturesPath}/tags-with-nested-fields.json`)
    expect(valid).toBe(true)
    expect(tags).toEqual({bar: 'world'})
    expect(context.stdout.toString()).toContain("[WARN] tag 'foo' had nested fields which will be ignored")
  })
  test('empty file path', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, '')
    expect(valid).toBe(true)
    expect(tags).toEqual({})
  })
  test('undefined file path', () => {
    const context = createMockContext()
    const [tags, valid] = parseTagsFile(context, undefined)
    expect(valid).toBe(true)
    expect(tags).toEqual({})
  })
  test('file does not exist', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, 'non-existent-file.json')
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain("[ERROR] file 'non-existent-file.json' does not exist")
  })
  test('path points to folder', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, `${fixturesPath}/invalid`)
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain('did not point to a file')
  })
  test('file is not a JSON', () => {
    const context = createMockContext()
    const [_, valid] = parseTagsFile(context, `${fixturesPath}/invalid/not-a-json.yaml`)
    expect(valid).toBe(false)
    expect(context.stderr.toString()).toContain('is not a JSON file')
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

describe('parseMetricsFile', () => {
  test('valid', () => {
    const context = createMockContext()
    const [measures, valid] = parseMeasuresFile(context, `${fixturesPath}/measures-valid.json`)
    expect(valid).toBe(true)
    expect(measures).toEqual({foo: 123, bar: 456})
  })
  test('valid but ignores data', () => {
    const context = createMockContext()
    const [measures, valid] = parseMeasuresFile(context, `${fixturesPath}/measures-mixed.json`)
    expect(valid).toBe(true)
    expect(measures).toEqual({measure: 888})
    expect(context.stdout.toString()).toContain('ignoring field')
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
