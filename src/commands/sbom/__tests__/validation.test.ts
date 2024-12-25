import {getValidator, validateFileAgainstToolRequirements, validateSbomFileAgainstSchema} from '../validation'

const validator = getValidator()

describe('validation of sbom file', () => {
  test('should succeed when called on a valid CycloneDX 1.4 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json', validator, false)
    ).toBeTruthy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', false)
    ).toBeTruthy()
  })
  test('should succeed when called on a valid CycloneDX 1.6 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/cdxgen-cyclonedx1.6.json', validator, false)
    ).toBeTruthy()
  })
  test('should succeed when called on a valid CycloneDX 1.5 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', validator, false)
    ).toBeTruthy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', false)
    ).toBeTruthy()
  })
  test('should fail on files that do not exist', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.4.do.not.exists', validator, false)
    ).toBeFalsy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.4.do.not.exists', false)
    ).toBeFalsy()
  })
  test('should fail on files that do not satisfy the schema', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.4.invalid.json', validator, false)
    ).toBeFalsy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.4.invalid.json', false)
    ).toBeTruthy()
  })
  test('should validate SBOM file from trivy 4.9', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/trivy-4.9.json', validator, true)
    ).toBeTruthy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/trivy-4.9.json', true)
    ).toBeTruthy()
  })
  test('SBOM with invalid purl are being rejected', () => {
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom-invalid-purl.json', true)
    ).toBeFalsy()
  })
  test('should validate SBOM file osv scanner - version 1.5', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/osv-scanner-files.json', validator, true)
    ).toBeTruthy()
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/osv-scanner-files.json', true)
    ).toBeTruthy()
  })
  test('SBOM with no components is valid', () => {
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom-no-components.json', true)
    ).toBeTruthy()
  })
  test('does not validate random data', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/random-data', validator, true)
    ).toBeFalsy()
    expect(validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/random-data', true)).toBeFalsy()
  })
})
