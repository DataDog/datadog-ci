import fs from 'fs'

import {DatadogCiConfig} from '../../../helpers/config'
import {getSpanTags} from '../../../helpers/tags'

import {generatePayload} from '../payload'
import {DependencyLanguage, DependencyLicense} from '../types'

describe('generation of payload', () => {
  test('should correctly work with a CycloneDX 1.4 file', async () => {
    const sbomFile = './src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json'
    const sbomContent = JSON.parse(fs.readFileSync(sbomFile).toString('utf8'))
    const config: DatadogCiConfig = {
      apiKey: undefined,
      env: undefined,
      envVarTags: undefined,
    }
    const tags = await getSpanTags(config, [])

    const payload = generatePayload(sbomContent, tags)
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

    const payload = generatePayload(sbomContent, tags)
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

    const payload = generatePayload(sbomContent, tags)

    expect(payload?.dependencies.length).toStrictEqual(305)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(3)

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

    const payload = generatePayload(sbomContent, tags)

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

    const payload = generatePayload(sbomContent, tags)

    expect(payload?.dependencies.length).toStrictEqual(89)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(26)

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

    const payload = generatePayload(sbomContent, tags)

    expect(payload?.dependencies.length).toStrictEqual(19)
    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toStrictEqual(19)

    // all languages are detected
    const dependenciesWithoutLanguage = payload?.dependencies.filter((d) => !d.language)
    expect(dependenciesWithoutLanguage?.length).toStrictEqual(0)
    const dependenciesWithPython = payload?.dependencies.filter((d) => d.language === DependencyLanguage.PYTHON)
    expect(dependenciesWithPython?.length).toStrictEqual(19)
  })
})
