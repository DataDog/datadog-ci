import fs from 'fs'

import {createMockContext} from '../../../helpers/__tests__/testing-tools'
import {DatadogCiConfig} from '../../../helpers/config'
import {getSpanTags} from '../../../helpers/tags'

import {generatePayload} from '../payload'
import {DependencyLanguage} from '../types'
import {
  filterInvalidDependencies,
  getValidator,
  validateDependencyName,
  validateFileAgainstToolRequirements,
  validateSbomFileAgainstSchema,
} from '../validation'

const validator = getValidator()

const logOptions = {
  context: createMockContext(),
  debug: false,
}

describe('validation of sbom file', () => {
  test('should succeed when called on a valid CycloneDX 1.4 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json', validator, logOptions)
    ).toBe(true)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', logOptions)
    ).toBe(true)
  })

  test('should succeed when called on a valid CycloneDX 1.6 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema(
        './src/commands/sbom/__tests__/fixtures/cdxgen-cyclonedx1.6.json',
        validator,
        logOptions
      )
    ).toBe(true)
  })

  test('should succeed when called on a valid CycloneDX 1.5 SBOM file', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', validator, logOptions)
    ).toBe(true)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json', logOptions)
    ).toBe(true)
  })

  test('should fail on files that do not exist', () => {
    expect(
      validateSbomFileAgainstSchema(
        './src/commands/sbom/__tests__/fixtures/sbom.1.4.do.not.exists',
        validator,
        logOptions
      )
    ).toBe(false)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.4.do.not.exists', logOptions)
    ).toBe(false)
  })

  test('should fail on files that do not satisfy the schema', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema(
        './src/commands/sbom/__tests__/fixtures/sbom.1.4.invalid.json',
        validator,
        logOptions
      )
    ).toBe(false)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom.1.4.invalid.json', logOptions)
    ).toBe(true)
  })

  test('should validate SBOM file from trivy 4.9', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/trivy-4.9.json', validator, logOptions)
    ).toBe(true)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/trivy-4.9.json', logOptions)
    ).toBe(true)
  })

  test('should validate SBOM file osv scanner - version 1.5', () => {
    // type and name of the "component" have been removed from the valid file.
    expect(
      validateSbomFileAgainstSchema(
        './src/commands/sbom/__tests__/fixtures/osv-scanner-files.json',
        validator,
        logOptions
      )
    ).toBe(true)
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/osv-scanner-files.json', logOptions)
    ).toBe(true)
  })

  test('SBOM with no components is valid', () => {
    expect(
      validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/sbom-no-components.json', logOptions)
    ).toBe(true)
  })

  test('does not validate random data', () => {
    expect(
      validateSbomFileAgainstSchema('./src/commands/sbom/__tests__/fixtures/random-data', validator, logOptions)
    ).toBe(false)
    expect(validateFileAgainstToolRequirements('./src/commands/sbom/__tests__/fixtures/random-data', logOptions)).toBe(
      false
    )
  })

  test('should have valid package name', () => {
    expect(
      validateDependencyName({
        name: 'foo bar',
        language: DependencyLanguage.PYTHON,
        version: undefined,
        group: undefined,
        licenses: [],
        purl: '',
        locations: [],
        is_direct: undefined,
        package_manager: 'pypi',
        is_dev: undefined,
        reachable_symbol_properties: undefined,
        exclusions: undefined,
      })
    ).toBe(false)
    expect(
      validateDependencyName({
        name: 'foobar',
        language: DependencyLanguage.PYTHON,
        version: undefined,
        group: undefined,
        licenses: [],
        purl: '',
        locations: [],
        is_direct: undefined,
        package_manager: 'pypi',
        is_dev: undefined,
        reachable_symbol_properties: undefined,
        exclusions: undefined,
      })
    ).toBe(true)
    expect(
      validateDependencyName({
        name: 'py',
        language: DependencyLanguage.PYTHON,
        version: undefined,
        group: undefined,
        licenses: [],
        purl: '',
        locations: [],
        is_direct: undefined,
        package_manager: 'pypi',
        is_dev: undefined,
        reachable_symbol_properties: undefined,
        exclusions: undefined,
      })
    ).toBe(true)
    expect(
      validateDependencyName({
        name: 'rx',
        language: DependencyLanguage.PYTHON,
        version: undefined,
        group: undefined,
        licenses: [],
        purl: '',
        locations: [],
        is_direct: undefined,
        package_manager: 'pypi',
        is_dev: undefined,
        reachable_symbol_properties: undefined,
        exclusions: undefined,
      })
    ).toBe(true)
  })

  test('should not filter purl if all are correct', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/cdxgen-cyclonedx1.6.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [], true)

    const payload = generatePayload(sbomContent, tags, 'service', 'env')
    expect(payload).not.toBeNull()
    expect(payload?.id).toStrictEqual(expect.any(String))

    const filteredDependencies = filterInvalidDependencies(payload!.dependencies, logOptions)
    expect(filteredDependencies).toHaveLength(payload!.dependencies.length)
  })

  test('should filter invalid purl', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom-invalid-purl.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [], true)

    const payload = generatePayload(sbomContent, tags, 'service', 'env')
    expect(payload).not.toBeNull()
    expect(payload?.id).toStrictEqual(expect.any(String))

    const filteredDependencies = filterInvalidDependencies(payload!.dependencies, logOptions)
    expect(filteredDependencies).toHaveLength(1)
    expect(filteredDependencies[0].purl).toEqual('pkg:pypi/jinja2@3.1.5')
  })
})
