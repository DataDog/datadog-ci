import {getValidator, validateSbomFile} from '../validation'

const validator = getValidator()

describe('validation of sbom file', () => {
  test('should succeed when called on a valid CycloneDX 1.4 SBOM file', () => {
    expect(validateSbomFile('./src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json', validator, false)).toBeTruthy()
  })
  test('should succeed when called on a valid CycloneDX 1.5 SBOM file', () => {
    expect(validateSbomFile('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', validator, false)).toBeTruthy()
  })
  test('should fail on files that do not exist', () => {
    expect(
      validateSbomFile('./src/commands/sbom/__tests__/fixtures/sbom.1.4.do.not.exists', validator, false)
    ).toBeFalsy()
  })
  test('should fail on files that do not satisfy the schema', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFile('./src/commands/sbom/__tests__/fixtures/sbom.1.4.invalid.json', validator, false)
    ).toBeFalsy()
  })
})
