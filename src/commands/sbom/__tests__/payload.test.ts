import fs from 'fs'

import {DatadogCiConfig} from '../../../helpers/config'
import {getSpanTags} from '../../../helpers/tags'

import {generatePayload} from '../payload'
import {DependencyLanguage, DependencyLicense, Location} from '../types'

describe('generation of payload', () => {
  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation()
    jest.spyOn(console, 'log').mockImplementation()
  })

  test('should correctly work with a CycloneDX 1.4 file', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')
    expect(payload).not.toBeNull()
    expect(payload?.id).toStrictEqual(expect.any(String))

    expect(payload?.commit.sha).toStrictEqual(expect.any(String))
    expect(payload?.commit.author_name).toStrictEqual(expect.any(String))
    expect(payload?.commit.author_email).toStrictEqual(expect.any(String))
    expect(payload?.commit.branch).toStrictEqual(expect.any(String))
    expect(payload?.repository.url).toContain('github.com')
    expect(payload?.repository.url).toContain('DataDog/datadog-ci')
    expect(payload?.dependencies.length).toBe(62)
    expect(payload?.dependencies[0].name).toBe('stack-cors')
    expect(payload?.dependencies[0].version).toBe('1.3.0')
    expect(payload?.dependencies[0].licenses.length).toBe(1)
    expect(payload?.dependencies[0].licenses[0]).toBe(DependencyLicense.MIT)
    expect(payload?.dependencies[0].language).toBe(DependencyLanguage.PHP)
  })
  test('should succeed when called on a valid SBOM file for CycloneDX 1.5', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')
    expect(payload).not.toBeNull()
    expect(payload?.id).toStrictEqual(expect.any(String))

    expect(payload?.commit.sha).toStrictEqual(expect.any(String))
    expect(payload?.commit.author_name).toStrictEqual(expect.any(String))
    expect(payload?.commit.author_email).toStrictEqual(expect.any(String))
    expect(payload?.commit.branch).toStrictEqual(expect.any(String))
    expect(payload?.repository.url).toContain('github.com')
    expect(payload?.repository.url).toContain('DataDog/datadog-ci')
    expect(payload?.dependencies.length).toBe(147)

    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toBe(17)
  })

  test('SBOM for rust with multiple licenses', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom-rust.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(305)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(3)

    // Check licenses is correct
    console.log(payload?.dependencies[0].licenses)
    expect(payload?.dependencies[0].licenses.length).toStrictEqual(1)

    expect(payload?.dependencies[1].licenses.length).toStrictEqual(2)
    expect(payload?.dependencies[1].licenses[0]).toStrictEqual(DependencyLicense.MIT)
    expect(payload?.dependencies[1].licenses[1]).toStrictEqual(DependencyLicense.APACHE2)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
  })

  test('SBOM generated for Ruby from a Gemfile lock', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom-ruby.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(64)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(64)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
  })

  test('SBOM generated for Java and Go', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom-java-go.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(89)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(10)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
    const dependenciesWithJava = payload?.dependencies.filter((d) => d.language === DependencyLanguage.JVM)
    expect(dependenciesWithJava?.length).toStrictEqual(55)
    const dependenciesWithGo = payload?.dependencies.filter((d) => d.language === DependencyLanguage.GO)
    expect(dependenciesWithGo?.length).toStrictEqual(34)
  })

  test('SBOM generated for Python', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom-python.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(19)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(19)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
    const dependenciesWithPython = payload?.dependencies.filter((d) => d.language === DependencyLanguage.PYTHON)
    expect(dependenciesWithPython?.length).toStrictEqual(19)
  })

  test('SBOM generated from Trivy 4.9 with group', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/trivy-4.9.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(433)
    const dependencies = payload?.dependencies
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(433)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
    const dependenciesWithNode = payload?.dependencies.filter((d) => d.language === DependencyLanguage.NPM)
    expect(dependenciesWithNode?.length).toStrictEqual(433)
    expect(dependencies?.filter((d) => d.group !== undefined).length).toBeGreaterThan(0)
    expect(dependencies && dependencies[10].group).toStrictEqual('@aws-sdk')
  })
  test('SBOM generated from osv-scanner with files', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/osv-scanner-files.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags, 'service', 'env')

    expect(payload?.dependencies.length).toStrictEqual(7368)
    const dependencies = payload!.dependencies

    // all languages are detected
    const dependenciesWithoutLocation = payload?.dependencies.filter((d) => !d.locations)
    expect(dependenciesWithoutLocation?.length).toStrictEqual(0)

    // Check that we can have multiple locations
    expect(dependencies[0].locations?.length).toStrictEqual(1)
    expect(dependencies[1].locations?.length).toStrictEqual(3)

    // check location correctness
    expect(dependencies[0]).not.toBeNull()
    expect(dependencies[0].locations![0].block!.start.line).toStrictEqual(19328)
    expect(dependencies[0].locations![0].block!.start.col).toStrictEqual(9)
    expect(dependencies[0].locations![0].block!.end.line).toStrictEqual(19336)
    expect(dependencies[0].locations![0].block!.end.col).toStrictEqual(10)

    // check that we do not have duplicate locations. The org.slf4j:slf4j-api in our test file has 988 locations
    // but 10 unique locations only (lots of duplicates). We make sure we only surface the non-duplicates ones.
    const dependencySlf4j = dependencies[55]
    expect(dependencySlf4j.name).toStrictEqual('org.slf4j:slf4j-api')
    expect(dependencySlf4j.locations?.length).toStrictEqual(10)

    // check that for a location, the end line is greater or equal to start line
    // if start and end lines are equal, the end col must be smaller than start col
    const checkLocation = (location: Location | undefined): void => {
      if (!location) {
        return
      }
      expect(location.end.line).toBeGreaterThanOrEqual(location.start.line)
      if (location.start.line === location.end.line) {
        // eslint-disable-next-line jest/no-conditional-expect
        expect(location.start.line).toBeGreaterThanOrEqual(location.end.line)
      }
    }

    // Check that all locations are valid
    for (const d of dependencies) {
      expect(d.locations).not.toBeNull()
      // just to avoid eslint warnings
      if (!d.locations) {
        continue
      }
      for (const l of d.locations) {
        checkLocation(l.block)
        checkLocation(l.name)
        checkLocation(l.namespace)
        checkLocation(l.version)
      }
    }
  })
})
