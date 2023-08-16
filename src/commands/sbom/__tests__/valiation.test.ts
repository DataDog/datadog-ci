import {getValidator, validateSbomFile} from '../validation'

const validator = getValidator()

describe('validation of sbom file', () => {
  test('should succeed when called on a valid SBOM file', () => {
    expect(validateSbomFile('./src/commands/sbom/__tests__/fixtures/bom.1.4.ok.json', validator)).toBeTruthy()
  })
  test('should fail on files that do not exists', () => {
    expect(validateSbomFile('./src/commands/sbom/__tests__/fixtures/bom.1.4.do.not.exists', validator)).toBeFalsy()
  })
  test('should fail on files that do not satisfy the schema', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(validateSbomFile('./src/commands/sbom/__tests__/fixtures/bom.1.4.invalid.json', validator)).toBeFalsy()
  })
})
