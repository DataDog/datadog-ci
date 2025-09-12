import fs from 'fs'

import {DatadogCiConfig} from '@datadog/datadog-ci-base/helpers/config'
import {getSpanTags} from '@datadog/datadog-ci-base/helpers/tags'

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
    ).toBeFalsy()
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
    ).toBeTruthy()
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
    ).toBeTruthy()
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
    ).toBeTruthy()
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

    const filteredDependencies = filterInvalidDependencies(payload!.dependencies)
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

    const filteredDependencies = filterInvalidDependencies(payload!.dependencies)
    expect(filteredDependencies).toHaveLength(1)
    expect(filteredDependencies[0].purl).toEqual('pkg:pypi/jinja2@3.1.5')
  })
})
