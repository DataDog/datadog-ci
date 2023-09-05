import fs from 'fs'

import {SERVICE} from '../../../helpers/tags'

import {generatePayload} from '../payload'
import {Classification} from '../protobuf/bom-1.4'
import {SBOMPayload} from '../protobuf/sbom_intake'
import {SbomPayloadData} from '../types'

/**
 * Generate the payload from a SBOM file
 * @param file - the JSON file to use to generate the payload
 */
const getPayload = (file: string) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const content = JSON.parse(fs.readFileSync(file).toString('utf8'))

  const payloadData: SbomPayloadData = {
    filePath: file,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    content,
  }

  return generatePayload(payloadData, 'my-service', {[SERVICE]: 'bar'})
}

/**
 * Check that the file correctly parse and have all the information we need
 * @param payload - the payload previously generated
 */
const checkFile = (payload: SBOMPayload) => {
  expect(payload.entities.length).toBe(1)
  expect(payload.source).toBe('CI')

  const entity = payload.entities[0]
  expect(entity.ddTags.length).toBe(1)
  expect(entity.ddTags[0]).toBe('service:bar')

  expect(entity.id).toBe('my-service')
  expect(entity.inUse).toBeTruthy()

  expect(entity.cyclonedx?.components.map((v) => v.type)).not.toContain(Classification.UNRECOGNIZED)
  // for each library, we should have a purl, name and version
  expect(
    entity.cyclonedx?.components.filter((v) => v.type === Classification.CLASSIFICATION_LIBRARY).map((v) => v.purl)
  ).not.toContain(undefined)
  expect(
    entity.cyclonedx?.components.filter((v) => v.type === Classification.CLASSIFICATION_LIBRARY).map((v) => v.name)
  ).not.toContain(undefined)
  expect(
    entity.cyclonedx?.components.filter((v) => v.type === Classification.CLASSIFICATION_LIBRARY).map((v) => v.version)
  ).not.toContain(undefined)
}

describe('payload of files', () => {
  test('should succeed when called on a valid SBOM file for CycloneDX 1.4', () => {
    const payload = getPayload('./src/commands/sbom/__tests__/fixtures/sbom.1.4.ok.json')
    checkFile(payload)
    const entity = payload.entities[0]
    expect(entity.cyclonedx?.components.length).toBe(62)
  })
  test('should succeed when called on a valid SBOM file for CycloneDX 1.5', () => {
    const payload = getPayload('./src/commands/sbom/__tests__/fixtures/sbom.1.5.ok.json')
    checkFile(payload)
    const entity = payload.entities[0]
    expect(entity.cyclonedx?.components.length).toBe(153)
  })
})
