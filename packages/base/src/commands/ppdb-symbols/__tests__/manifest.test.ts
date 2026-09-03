import {lookupDebugId, readDebugIdManifest} from '../manifest'

const fixtureDir = 'src/commands/ppdb-symbols/__tests__/fixtures'

describe('readDebugIdManifest', () => {
  test('parses a valid manifest into an assembly name -> debug ID map', () => {
    const manifest = readDebugIdManifest(`${fixtureDir}/manifest.json`)

    expect(manifest).toEqual({
      MyApp: 'aabbccdd11223344aabbccdd1122334455667788',
      'MyApp.Core': '11223344aabbccdd11223344aabbccdd11223344',
    })
  })

  test('throws if the manifest is not valid JSON', () => {
    expect(() => readDebugIdManifest(`${fixtureDir}/notJson.json`)).toThrow()
  })

  test('throws if a debug ID value is not a string', () => {
    expect(() => readDebugIdManifest(`${fixtureDir}/invalidManifest.json`)).toThrow(
      /non-string debug ID for assembly "MyApp"/
    )
  })

  test('throws if the manifest file does not exist', () => {
    expect(() => readDebugIdManifest(`${fixtureDir}/missing.json`)).toThrow()
  })

  test('throws if the top-level JSON value is an array', () => {
    expect(() => readDebugIdManifest(`${fixtureDir}/arrayManifest.json`)).toThrow(/is not a JSON object/)
  })

  test('throws if the top-level JSON value is a scalar', () => {
    expect(() => readDebugIdManifest(`${fixtureDir}/scalarManifest.json`)).toThrow(/is not a JSON object/)
  })
})

describe('lookupDebugId', () => {
  const manifest = {
    MyApp: 'aabbccdd11223344aabbccdd1122334455667788',
    Untracked: '',
  }

  test('returns the debug ID for an exact-case match', () => {
    expect(lookupDebugId(manifest, 'MyApp')).toBe('aabbccdd11223344aabbccdd1122334455667788')
  })

  test('falls back to a case-insensitive match', () => {
    expect(lookupDebugId(manifest, 'myapp')).toBe('aabbccdd11223344aabbccdd1122334455667788')
    expect(lookupDebugId(manifest, 'MYAPP')).toBe('aabbccdd11223344aabbccdd1122334455667788')
  })

  test('returns an empty-string debug ID as-is, not as missing', () => {
    expect(lookupDebugId(manifest, 'Untracked')).toBe('')
  })

  test('returns undefined when no entry matches, case-insensitively', () => {
    expect(lookupDebugId(manifest, 'SomeOtherApp')).toBeUndefined()
  })
})
