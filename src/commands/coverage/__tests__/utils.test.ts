import {detectFormat, validateCoverageReport} from '../utils'

describe('utils', () => {
  describe('validateCoverageReport', () => {
    test('Returns undefined for a valid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(validateCoverageReport(filePath, 'jacoco')).toBeUndefined()
    })

    test('Returns undefined for a valid Jacoco report with user-provided format', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(validateCoverageReport(filePath, 'jacoco')).toBeUndefined()
    })

    test('Returns error message for an invalid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/invalid-jacoco-report.xml'
      expect(validateCoverageReport(filePath, 'jacoco')).toMatch(/.+/)
    })

    test('Returns error message for a Jacoco report with invalid root tag', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report-incorrect-root-tag.xml'
      expect(validateCoverageReport(filePath, 'jacoco')).toMatch(/.+/)
    })
  })

  describe('detectFormat', () => {
    test('Detects Jacoco format for a valid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(detectFormat(filePath)).toEqual('jacoco')
    })

    test('Returns undefined for a non-XML file', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/non-xml-file.txt'
      expect(detectFormat(filePath)).toBeUndefined()
    })

    test('Returns undefined for a non-Jacoco XML file', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/random-file.xml'
      expect(detectFormat(filePath)).toBeUndefined()
    })
  })
})
