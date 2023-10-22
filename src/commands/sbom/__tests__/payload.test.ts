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
    expect(payload?.id).not.toBeNull()

    expect(payload?.commit.sha).not.toBeNull()
    expect(payload?.commit.author_name).not.toBeNull()
    expect(payload?.commit.author_email).not.toBeNull()
    expect(payload?.commit.branch).not.toBeNull()
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
    expect(payload?.id).not.toBeNull()

    expect(payload?.commit.sha).not.toBeNull()
    expect(payload?.commit.author_name).not.toBeNull()
    expect(payload?.commit.author_email).not.toBeNull()
    expect(payload?.commit.branch).not.toBeNull()
    expect(payload?.repository.url).toContain('github.com')
    expect(payload?.repository.url).toContain('DataDog/datadog-ci')
    expect(payload?.dependencies.length).toBe(147)

    const dependenciesWithoutLicense = payload?.dependencies.filter((d) => d.licenses.length === 0)
    expect(dependenciesWithoutLicense?.length).toBe(17)
  })
})
