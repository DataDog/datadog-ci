import {readDebugIdManifest} from '../manifest'

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
})
